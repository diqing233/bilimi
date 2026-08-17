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

  it('aborts the active provider request and reports cancellation only after the request settles', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    let observedSignal: AbortSignal | undefined
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn((_request, signal?: AbortSignal) => {
      observedSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const organizing = service.organizeCurrentSegment('100')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(observedSignal?.aborted).toBe(false)
    expect(service.cancelCurrentSegment('100')).toBe(true)
    await expect(organizing).resolves.toMatchObject({ canceled: true, failures: [] })
    expect(observedSignal?.aborted).toBe(true)
  })

  it('keeps the cancellation command pending until an active provider request releases ownership', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    let resolveGenerate: ((result: {
      kind: 'favorite-archive-organize'
      results: Array<{ aid: number; targetLedgerIds: string[]; keepOriginal: boolean; reason: string; lowConfidence: boolean }>
      keywordSuggestions: never[]
    }) => void) | undefined
    const generate = vi.fn(() => new Promise<{
      kind: 'favorite-archive-organize'
      results: Array<{ aid: number; targetLedgerIds: string[]; keepOriginal: boolean; reason: string; lowConfidence: boolean }>
      keywordSuggestions: never[]
    }>((resolve) => { resolveGenerate = resolve }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: {
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
        applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
      } as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const organizing = service.organizeCurrentSegment('100')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    const canceling = service.cancelPendingAllSegments('100')
    let cancellationSettled = false
    void canceling.then(() => { cancellationSettled = true })
    await Promise.resolve()

    expect(cancellationSettled).toBe(false)

    resolveGenerate?.({
      kind: 'favorite-archive-organize',
      results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }],
      keywordSuggestions: []
    })
    await expect(canceling).resolves.toBe(true)
    await expect(organizing).resolves.toMatchObject({ canceled: true })
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

  it('automatically adopts merge-latest once when DeepSeek sees recovery required', async () => {
    const recovery = {
      recovery: 'rebuild-required' as const,
      preserveCompletedLocalResults: true as const,
      accountMid: '100',
      workspaceId: 'workspace-1'
    }
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] },
      classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValueOnce(recovery).mockResolvedValue(snapshot),
      getRecoverySummary: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: {
          scope: 'account', workspaceBaselineRevision: 4, repositoryRevision: 5, changed: true,
          direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['metadata']
        },
        recoveryChoices: ['view', 'merge-latest']
      }),
      selectRecoveryDecision: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', choice: 'merge-latest',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
      }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize' as const,
      results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }],
      keywordSuggestions: []
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }]
      }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({ snapshot })
    expect(coordinator.selectRecoveryDecision).toHaveBeenCalledWith('100', {
      workspaceId: 'workspace-1',
      choice: 'merge-latest',
      expectedBaselineRevision: 4,
      expectedRepositoryRevision: 5
    })
    expect(coordinator.getSnapshot).toHaveBeenCalledTimes(3)
  })

  it('rejects DeepSeek organization for a batch whose tags are still being enriched', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', status: 'previewing' as const, readiness: 'tagging' as const }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn()
    }
    const generate = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [] }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow(
      'Old favorite workspace current batch tag enrichment is not complete.'
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

  it('merges DeepSeek results per video and reports only changed videos as conflicts', async () => {
    const before = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [
        { aid: 1, title: 'Stable', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Changed', sourceFolderIds: ['source'] }
      ] }, classifications: {}
    }
    const current = {
      ...before,
      classifications: { '2': { aid: 2, targetLedgerIds: ['manual'], source: 'manual' } }
    }
    const detailedApply = vi.fn().mockResolvedValue({ snapshot: {} as never, appliedAids: [1], conflictAids: [2] })
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(current),
      applyDeepSeekClassificationBatch: vi.fn().mockRejectedValue(new Error('legacy strict path must not be used')),
      applyDeepSeekClassificationBatchWithConflicts: detailedApply
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [
          { aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false },
          { aid: 2, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }
        ], keywordSuggestions: []
      })
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
      progress: { successfulVideoCount: 1, failedVideoCount: 1 },
      failures: [{ category: 'workspace-conflict', aids: [2] }]
    })
    expect(detailedApply).toHaveBeenCalledOnce()
    expect(coordinator.applyDeepSeekClassificationBatch).not.toHaveBeenCalled()
  })

  it('splits a large current segment into legacy twenty-video requests and durably applies each group', async () => {
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
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledTimes(2)
    expect(coordinator.applyDeepSeekClassificationBatch.mock.calls.map(([, assignments]) => assignments.length)).toEqual([20, 11])
  })

  it('retries one timed-out twenty-video group once before succeeding', async () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = { accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }], currentSegment: { id: 'segment-1', items }, classifications: {} }
    const coordinator = { getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}) }
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockImplementation(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: coordinator as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate, retryDelay })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({ progress: { successfulVideoCount: 20, failedVideoCount: 0 } })
    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([items.map((item) => item.aid), items.map((item) => item.aid)])
    expect(retryDelay).toHaveBeenCalledOnce()
  })

  it('splits a twenty-video group into stable ten-video children after its timeout retry', async () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = { accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }], currentSegment: { id: 'segment-1', items }, classifications: {} }
    const coordinator = { getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}) }
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockImplementation(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: coordinator as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate, retryDelay: vi.fn().mockResolvedValue(undefined) })

    await service.organizeCurrentSegment('100')

    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([
      items.map((item) => item.aid), items.map((item) => item.aid),
      items.slice(0, 10).map((item) => item.aid), items.slice(10).map((item) => item.aid)
    ])
  })

  it('persists stable split child ids in the durable all-run checkpoint', async () => {
    let checkpoint: any = null
    const items = Array.from({ length: 20 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: false,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', items }, classifications: {}
    })
    const coordinator = {
      getSnapshot: vi.fn(async () => snapshot()), selectSegment: vi.fn(), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockImplementation(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: coordinator as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate, retryDelay: vi.fn().mockResolvedValue(undefined) })

    await service.organizeAllSegments('100')

    expect(checkpoint).toBeNull()
    const persistedPlans = coordinator.setDeepSeekRunCheckpoint.mock.calls.map(([, next]) => next).filter(Boolean)
    expect(persistedPlans.at(-1)?.requestGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'segment-1:group:1:1-20', status: 'split' }),
      expect.objectContaining({ id: 'segment-1:group:1:1-20:left', parentId: 'segment-1:group:1:1-20', aids: items.slice(0, 10).map((item) => item.aid) }),
      expect.objectContaining({ id: 'segment-1:group:1:1-20:right', parentId: 'segment-1:group:1:1-20', aids: items.slice(10).map((item) => item.aid) })
    ]))
  })

  it('does not start a retry until the timed-out provider promise has conclusively settled', async () => {
    const snapshot = { accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }], currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {} }
    let active = 0
    let overlapped = false
    const generate = vi.fn(async (request) => {
      active += 1
      if (active > 1) overlapped = true
      try {
        if (generate.mock.calls.length === 1) throw new Error('DeepSeek request timed out after 180 seconds.')
        return { kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }
      } finally {
        active -= 1
      }
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: { getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}) } as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate, retryDelay: vi.fn().mockResolvedValue(undefined) })

    await service.organizeCurrentSegment('100')

    expect(overlapped).toBe(false)
  })

  it('splits a timed-out ten-video child into fives without resending its successful sibling', async () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = { accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }], currentSegment: { id: 'segment-1', items }, classifications: {} }
    const coordinator = { getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}) }
    const success = (request: any) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] })
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockImplementationOnce(async (request) => success(request))
      .mockRejectedValueOnce(new Error('DeepSeek request timed out after 180 seconds.'))
      .mockImplementation(async (request) => success(request))
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: coordinator as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate, retryDelay: vi.fn().mockResolvedValue(undefined) })

    await service.organizeCurrentSegment('100')

    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([
      items.map((item) => item.aid), items.map((item) => item.aid),
      items.slice(0, 10).map((item) => item.aid), items.slice(10).map((item) => item.aid),
      items.slice(10, 15).map((item) => item.aid), items.slice(15).map((item) => item.aid)
    ])
  })

  it.each([
    ['timeout', new Error('DeepSeek request timed out after 180 seconds.')],
    ['rate-limit', new Error('DeepSeek API request failed: 429 Too Many Requests')],
    ['server', new Error('DeepSeek API request failed: 503 Service Unavailable')],
    ['network', new Error('socket disconnected')]
  ] as const)('categorizes %s provider failures', async (category, error) => {
    const snapshot = { accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }], currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {} }
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: { getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn() } as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate: vi.fn().mockRejectedValue(error), retryDelay: vi.fn().mockResolvedValue(undefined) })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({ failures: [{ category }] })
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
    expect(progress).toHaveBeenNthCalledWith(2, expect.objectContaining({ totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }))
    expect(progress).toHaveBeenNthCalledWith(3, expect.objectContaining({ totalChunks: 2, completedChunks: 2, totalVideoCount: 21, successfulVideoCount: 21, failedVideoCount: 0 }))
  })

  it('publishes details only for available videos that a settled request actually processed', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [
        { aid: 1, title: 'Processed', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Not scanned', sourceFolderIds: ['source'], unavailable: true }
      ] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } }
    }
    const progress = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: {
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
        applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
      } as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn(async (request) => ({
        kind: 'favorite-archive-organize' as const,
        results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: [], keepOriginal: true, reason: 'keep', lowConfidence: false })),
        keywordSuggestions: []
      }))
    })

    await service.organizeCurrentSegment('100', 'all', progress)

    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      processedItems: [{
        aid: 1,
        title: 'Processed',
        beforeTargetLedgerIds: ['music'],
        afterTargetLedgerIds: ['music'],
        changed: false
      }]
    }))
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

  it('excludes unavailable videos before preserving a completed batch after cancellation', async () => {
    const unavailableItems = [
      { aid: 1, title: 'Unavailable flag', unavailable: true, sourceFolderIds: ['source'] },
      { aid: 2, title: '已失效视频', sourceFolderIds: ['source'] },
      { aid: 3, title: 'Deleted account', author: '账号已注销', sourceFolderIds: ['source'] }
    ]
    const validItems = Array.from({ length: 21 }, (_, index) => ({
      aid: index + 4,
      title: `Video ${index + 4}`,
      sourceFolderIds: ['source']
    }))
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [...unavailableItems, ...validItems] }, classifications: {}
    }
    const unavailableAids = new Set(unavailableItems.map((item) => item.aid))
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn(async (_accountMid: string, assignments: Array<{ aid: number }>) => {
        if (assignments.some((assignment) => unavailableAids.has(assignment.aid))) {
          throw new Error('Old favorite workspace classifications must target selected sources.')
        }
        return snapshot
      })
    }
    const firstBatchResult = {
      kind: 'favorite-archive-organize' as const,
      results: validItems.slice(0, 20).map((video) => ({
        aid: video.aid,
        targetLedgerIds: ['music'],
        keepOriginal: false,
        reason: 'ok',
        lowConfidence: false
      })),
      keywordSuggestions: [] as never[]
    }
    let resolveFirstBatch: ((value: typeof firstBatchResult) => void) | undefined
    const generate = vi.fn((_request: { videos: Array<{ aid: number }> }) =>
      new Promise<typeof firstBatchResult>((resolve) => { resolveFirstBatch = resolve }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 1, isDefault: false }]
      }),
      generate
    })

    const pending = service.organizeCurrentSegment('100')
    await Promise.resolve()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(service.cancelCurrentSegment('100')).toBe(true)
    resolveFirstBatch?.(firstBatchResult)

    await expect(pending).resolves.toMatchObject({
      canceled: true,
      progress: { totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }
    })
    expect(generate.mock.calls[0]![0].videos.map((video: { aid: number }) => video.aid)).toEqual(validItems.slice(0, 20).map((item) => item.aid))
    expect(generate).toHaveBeenCalledTimes(1)
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100',
      validItems.slice(0, 20).map((video) => ({ aid: video.aid, targetLedgerIds: ['music'] })), expect.any(Object))
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
    expect(coordinator.selectSegment.mock.calls.map(([, segmentId]) => segmentId)).toEqual([
      'segment-2', 'segment-1',
      'segment-2', 'segment-1'
    ])
  })

  it('persists the complete immutable all-segment work plan before the first provider request', async () => {
    let currentSegmentId = 'segment-1'
    let checkpoint: any = null
    const segmentItems = new Map([
      ['segment-1', Array.from({ length: 43 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))],
      ['segment-2', Array.from({ length: 43 }, (_, index) => ({ aid: index + 44, title: `Video ${index + 44}`, sourceFolderIds: ['source'] }))],
      ['segment-3', Array.from({ length: 43 }, (_, index) => ({ aid: index + 87, title: `Video ${index + 87}`, sourceFolderIds: ['source'] }))]
    ])
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [...segmentItems.keys()].map((id, index) => ({ id, index, status: 'previewing' as const, readiness: 'ready' as const })),
        currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] }, classifications: {}
      })),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn(async (request) => {
      expect(checkpoint).toMatchObject({
        version: 1,
        workspaceId: 'workspace-1',
        totalVideoCount: 129,
        segmentWork: [
          { segmentId: 'segment-1', aids: Array.from({ length: 43 }, (_, index) => index + 1) },
          { segmentId: 'segment-2', aids: Array.from({ length: 43 }, (_, index) => index + 44) },
          { segmentId: 'segment-3', aids: Array.from({ length: 43 }, (_, index) => index + 87) }
        ]
      })
      return {
        kind: 'favorite-archive-organize' as const,
        results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
        keywordSuggestions: []
      }
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await expect(service.organizeAllSegments('100')).resolves.toMatchObject({
      progress: { totalVideoCount: 129, successfulVideoCount: 129 }
    })
    expect(generate).toHaveBeenCalled()
  })

  it('does not count unprocessed all-batch aids after cancellation', async () => {
    let currentSegmentId = 'segment-1'
    let checkpoint: any = null
    let cancellationRequest = true
    let secondRequestStartedResolve: (() => void) | undefined
    const secondRequestStarted = new Promise<void>((resolve) => { secondRequestStartedResolve = resolve })
    const segmentItems = new Map([
      ['segment-1', Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))],
      ['segment-2', [{ aid: 22, title: 'Video 22', sourceFolderIds: ['source'] }]]
    ])
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [...segmentItems.keys()].map((id, index) => ({ id, index, status: 'previewing' as const, readiness: 'ready' as const })),
        currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] }, classifications: {}
      })),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(undefined),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = next ? structuredClone(next) : null })
    }
    const generate = vi.fn(async (request: { videos: Array<{ aid: number }> }, signal?: AbortSignal) => {
      if (cancellationRequest && request.videos[0]?.aid === 21) {
        secondRequestStartedResolve?.()
        return await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
      return {
        kind: 'favorite-archive-organize' as const,
        results: request.videos.map((video) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
        keywordSuggestions: [] as never[]
      }
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const firstRun = service.organizeAllSegments('100')
    await secondRequestStarted
    expect(service.cancelCurrentSegment('100')).toBe(true)
    await expect(firstRun).resolves.toMatchObject({
      canceled: true,
      progress: { totalVideoCount: 22, successfulVideoCount: 20, failedVideoCount: 0 }
    })
    expect(checkpoint).toMatchObject({
      successfulAids: Array.from({ length: 20 }, (_, index) => index + 1),
      pendingAids: [21, 22],
      failedAids: [],
      completedSegmentIds: []
    })

    cancellationRequest = false
    await service.organizeAllSegments('100')
    expect(generate.mock.calls.slice(2).map(([request]) => request.videos.map((video) => video.aid))).toEqual([[21], [22]])
  })

  it('keeps an all-batch cancellation pending until its inter-batch cancellation checkpoint is durable', async () => {
    let currentSegmentId = 'segment-1'
    let checkpoint: any = null
    let firstSegmentCheckpointStartedResolve: (() => void) | undefined
    const firstSegmentCheckpointStarted = new Promise<void>((resolve) => { firstSegmentCheckpointStartedResolve = resolve })
    let releaseFirstSegmentCheckpoint: (() => void) | undefined
    const firstSegmentCheckpointRelease = new Promise<void>((resolve) => { releaseFirstSegmentCheckpoint = resolve })
    let canceledCheckpointStartedResolve: (() => void) | undefined
    const canceledCheckpointStarted = new Promise<void>((resolve) => { canceledCheckpointStartedResolve = resolve })
    let releaseCanceledCheckpoint: (() => void) | undefined
    const canceledCheckpointRelease = new Promise<void>((resolve) => { releaseCanceledCheckpoint = resolve })
    const segmentItems = new Map([
      ['segment-1', [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }]],
      ['segment-2', [{ aid: 2, title: 'Video 2', sourceFolderIds: ['source'] }]]
    ])
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [...segmentItems.keys()].map((id, index) => ({ id, index, status: 'previewing' as const, readiness: 'ready' as const })),
        currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] }, classifications: {}
      })),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(undefined),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => {
        if (next?.completedSegmentIds?.includes('segment-1') && !next.canceled) {
          firstSegmentCheckpointStartedResolve?.()
          await firstSegmentCheckpointRelease
        }
        if (next?.canceled) {
          canceledCheckpointStartedResolve?.()
          await canceledCheckpointRelease
        }
        checkpoint = next ? structuredClone(next) : null
      })
    }
    const generate = vi.fn(async (request: { videos: Array<{ aid: number }> }) => ({
      kind: 'favorite-archive-organize' as const,
      results: request.videos.map((video) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
      keywordSuggestions: [] as never[]
    }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const organizing = service.organizeAllSegments('100')
    await firstSegmentCheckpointStarted
    const cancellation = service.cancelPendingAllSegments('100')
    let cancellationSettled = false
    void cancellation.then(() => { cancellationSettled = true })
    releaseFirstSegmentCheckpoint?.()
    await canceledCheckpointStarted
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    try {
      expect(cancellationSettled).toBe(false)
    } finally {
      releaseCanceledCheckpoint?.()
    }
    await expect(cancellation).resolves.toBe(true)
    await expect(organizing).resolves.toMatchObject({ canceled: true })
    expect(generate.mock.calls.map(([request]) => request.videos.map((video) => video.aid))).toEqual([[1]])
    expect(checkpoint).toMatchObject({ canceled: true, successfulAids: [1], pendingAids: [2] })
  })

  it('cancels an all-batch run before its startup snapshot can begin a provider request', async () => {
    let resolveInitialSnapshot: ((snapshot: any) => void) | undefined
    const initialSnapshot = new Promise<any>((resolve) => { resolveInitialSnapshot = resolve })
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    const generate = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: {
        getSnapshot: vi.fn().mockReturnValueOnce(initialSnapshot).mockResolvedValue(snapshot),
        selectSegment: vi.fn(),
        applyDeepSeekClassificationBatch: vi.fn(),
        getDeepSeekRunCheckpoint: vi.fn(),
        setDeepSeekRunCheckpoint: vi.fn()
      } as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const organizing = service.organizeAllSegments('100')
    const cancellation = service.cancelPendingAllSegments('100')
    resolveInitialSnapshot?.(snapshot)

    await expect(cancellation).resolves.toBe(true)
    await expect(organizing).resolves.toMatchObject({ canceled: true, snapshot })
    expect(generate).not.toHaveBeenCalled()
  })

  it('rejects cancellation when its all-batch cancellation checkpoint cannot be persisted', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    const generate = vi.fn((_request, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: {
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
        selectSegment: vi.fn(),
        applyDeepSeekClassificationBatch: vi.fn(),
        getDeepSeekRunCheckpoint: vi.fn(),
        setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, checkpoint: { canceled?: boolean } | null) => {
          if (checkpoint?.canceled) throw new Error('cancel checkpoint unavailable')
        })
      } as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const organizing = service.organizeAllSegments('100')
    const organizingRejection = expect(organizing).rejects.toThrow('cancel checkpoint unavailable')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())

    await expect(service.cancelPendingAllSegments('100')).rejects.toThrow('cancel checkpoint unavailable')
    await organizingRejection
  })

  it('allows a failed cancellation checkpoint to be retried without leaving the run active', async () => {
    let rejectCanceledCheckpoint = true
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    const generate = vi.fn((_request, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: {
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
        selectSegment: vi.fn(),
        applyDeepSeekClassificationBatch: vi.fn(),
        getDeepSeekRunCheckpoint: vi.fn(),
        setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, checkpoint: { canceled?: boolean } | null) => {
          if (checkpoint?.canceled && rejectCanceledCheckpoint) throw new Error('cancel checkpoint unavailable')
        })
      } as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const firstRun = service.organizeAllSegments('100')
    const firstRunRejection = expect(firstRun).rejects.toThrow('cancel checkpoint unavailable')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    await expect(service.cancelPendingAllSegments('100')).rejects.toThrow('cancel checkpoint unavailable')
    await firstRunRejection

    rejectCanceledCheckpoint = false
    const secondRun = service.organizeAllSegments('100')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    await expect(service.cancelPendingAllSegments('100')).resolves.toBe(true)
    await expect(secondRun).resolves.toMatchObject({ canceled: true })
  })

  it('clears historical cancellation before restart and sends only unfinished aids', async () => {
    let checkpoint: any = {
      version: 1, workspaceId: 'workspace-1', mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [{ segmentId: 'segment-1', index: 0, aids: [1, 2] }], totalVideoCount: 2,
      requestGroups: [
        { id: 'segment-1:group:1-2', segmentId: 'segment-1', aids: [1, 2], status: 'pending', timeoutCount: 0 }
      ], successfulAids: [1], pendingAids: [2], failedAids: [], completedSegmentIds: [], waitingSegmentIds: [],
      canceled: true
    }
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: false,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
        currentSegment: { id: 'segment-1', items: [1, 2].map((aid) => ({ aid, title: `Video ${aid}`, sourceFolderIds: ['source'] })) },
        classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'deepseek' } },
        deepSeekRun: checkpoint.canceled ? { mode: 'all', scope: 'all', status: 'canceled', completedSegmentCount: 0, waitingSegmentCount: 0 } : { mode: 'all', scope: 'all', status: 'running', completedSegmentCount: 0, waitingSegmentCount: 0 }
      })),
      selectSegment: vi.fn(), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn(async (request) => {
      expect(checkpoint.canceled).toBe(false)
      return { kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await service.organizeAllSegments('100')

    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[2]])
  })

  it('finishes ready batches without polling later tagging or not-yet-scanned batches', async () => {
    let currentSegmentId = 'segment-1'
    const getSnapshot = vi.fn(async () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'tagging' as const },
        { id: 'segment-3', status: 'previewing' as const, readiness: 'waiting' as const }
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
        deferredSegmentCount: 2,
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
      'segment-2', 'segment-1',
      'segment-1', 'segment-1'
    ])
  })

  it('rebuilds failed retry ownership from the durable checkpoint after a service restart', async () => {
    let checkpoint: any = {
      version: 1, workspaceId: 'workspace-1', mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [{ segmentId: 'segment-1', index: 0, aids: [1] }], totalVideoCount: 1,
      originalTargetLedgerIdsByAid: { '1': [] },
      requestGroups: [{ id: 'segment-1:group:1:1-1', segmentId: 'segment-1', aids: [1], status: 'failed', timeoutCount: 1 }],
      successfulAids: [], pendingAids: [], failedAids: [1], completedSegmentIds: [], waitingSegmentIds: [], canceled: false, failed: true
    }
    const snapshot = () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: false,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }] }, classifications: {}
    })
    const coordinator = {
      getSnapshot: vi.fn(async () => snapshot()), selectSegment: vi.fn(), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn(async (request) => ({
      kind: 'favorite-archive-organize' as const,
      results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
      keywordSuggestions: []
    }))
    const restarted = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await restarted.retryFailedChunks('100')

    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1]])
    expect(checkpoint).toBeNull()
  })

  it('persists a successful request group before starting the next group', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    let checkpoint: any
    let classifications: Record<string, { aid: number; targetLedgerIds: string[]; source: string }> = {}
    const snapshot = () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: false,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', items }, classifications
    })
    const coordinator = {
      getSnapshot: vi.fn(async () => snapshot()), selectSegment: vi.fn(),
      applyDeepSeekClassificationBatch: vi.fn(async (_accountMid: string, assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => {
        classifications = { ...classifications, ...Object.fromEntries(assignments.map((assignment) => [String(assignment.aid), { ...assignment, source: 'deepseek' }])) }
        return snapshot()
      }),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn(async (request) => {
      if (generate.mock.calls.length === 2) {
        expect(checkpoint.successfulAids).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
        expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledOnce()
      }
      return {
        kind: 'favorite-archive-organize' as const,
        results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
        keywordSuggestions: []
      }
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await service.organizeAllSegments('100')

    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledTimes(2)
    expect(checkpoint).toBeNull()
  })

  it('removes retried successes from durable failed aids when another retry still fails', async () => {
    let currentSegmentId = 'segment-1'
    let checkpoint: any = {
      version: 1, workspaceId: 'workspace-1', mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [
        { segmentId: 'segment-1', index: 0, aids: [1] },
        { segmentId: 'segment-2', index: 1, aids: [2] }
      ], totalVideoCount: 2, originalTargetLedgerIdsByAid: { '1': [], '2': [] },
      requestGroups: [
        { id: 'segment-1:group:1:1-1', segmentId: 'segment-1', aids: [1], status: 'failed', timeoutCount: 0 },
        { id: 'segment-2:group:1:2-2', segmentId: 'segment-2', aids: [2], status: 'failed', timeoutCount: 0 }
      ], successfulAids: [], pendingAids: [], failedAids: [1, 2], completedSegmentIds: [], waitingSegmentIds: [], canceled: false, failed: true
    }
    const items = new Map([
      ['segment-1', [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }]],
      ['segment-2', [{ aid: 2, title: 'Video 2', sourceFolderIds: ['source'] }]]
    ])
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [...items.keys()].map((id, index) => ({ id, index, status: 'previewing' as const, readiness: 'ready' as const })),
        currentSegment: { id: currentSegmentId, items: items.get(currentSegmentId) ?? [] }, classifications: {}
      })),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn()
      .mockResolvedValueOnce({
        kind: 'favorite-archive-organize' as const,
        results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }], keywordSuggestions: []
      })
      .mockRejectedValueOnce(new Error('network unavailable'))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await expect(service.retryFailedChunks('100')).resolves.toMatchObject({ failures: [{ aids: [2] }] })

    expect(checkpoint).toMatchObject({ successfulAids: [1], failedAids: [2], pendingAids: [], failed: true })
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

  it('persists completed all-batch checkpoints and resumes only newly ready batches after service reconstruction', async () => {
    let currentSegmentId = 'segment-1'
    let secondSegmentReady = false
    let checkpoint: {
      workspaceId: string
      mode: 'all'
      scope: 'all'
      completedSegmentIds: string[]
      waitingSegmentIds: string[]
      canceled: boolean
    } | null = null
    const segmentItems = new Map([
      ['segment-1', [{ aid: 1, title: 'Ready now', sourceFolderIds: ['source'] }]],
      ['segment-2', [{ aid: 2, title: 'Ready later', sourceFolderIds: ['source'] }]]
    ])
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [
          { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
          { id: 'segment-2', status: 'previewing' as const, readiness: secondSegmentReady ? 'ready' as const : 'tagging' as const }
        ],
        currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] },
        classifications: {}
      })),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: typeof checkpoint) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn(async (request) => ({
      kind: 'favorite-archive-organize' as const,
      results: request.videos.map((video: { aid: number }) => ({
        aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false
      })),
      keywordSuggestions: []
    }))
    const options = {
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: false }]
      }),
      generate
    }

    const firstService = new OldFavoriteWorkspaceDeepSeekService(options)
    await expect(firstService.organizeAllSegments('100')).resolves.toMatchObject({
      deferredSegmentCount: 1,
      progress: { totalVideoCount: 1, successfulVideoCount: 1 }
    })
    expect(checkpoint).toMatchObject({
      workspaceId: 'workspace-1', mode: 'all', scope: 'all',
      completedSegmentIds: ['segment-1'], waitingSegmentIds: ['segment-2'], canceled: false
    })

    secondSegmentReady = true
    const reconstructedService = new OldFavoriteWorkspaceDeepSeekService(options)
    await expect(reconstructedService.resumePendingAllSegments('100', ['segment-2'])).resolves.toBeNull()
    await expect(reconstructedService.organizeAllSegments('100')).resolves.toMatchObject({
      deferredSegmentCount: 0,
      progress: { totalVideoCount: 2, successfulVideoCount: 2 }
    })
    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1], [2]])
    expect(checkpoint).toBeNull()
  })

  it('repairs a legacy all-batch checkpoint that incorrectly queued batches still waiting for tags', async () => {
    let currentSegmentId = 'segment-1'
    let checkpoint: any = {
      version: 1, workspaceId: 'workspace-1', mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [
        { segmentId: 'segment-1', index: 0, aids: [1] },
        { segmentId: 'segment-2', index: 1, aids: [2] }
      ],
      totalVideoCount: 2,
      originalTargetLedgerIdsByAid: { '1': [], '2': [] },
      requestGroups: [
        { id: 'segment-1:group:1:1-1', segmentId: 'segment-1', aids: [1], status: 'complete', timeoutCount: 0 },
        { id: 'segment-2:group:1:2-2', segmentId: 'segment-2', aids: [2], status: 'pending', timeoutCount: 0 }
      ],
      successfulAids: [1], pendingAids: [2], failedAids: [],
      completedSegmentIds: ['segment-1'], waitingSegmentIds: [], canceled: true
    }
    const coordinator = {
      getSnapshot: vi.fn(async () => ({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        segments: [
          { id: 'segment-1', index: 0, status: 'previewing' as const, readiness: 'ready' as const },
          { id: 'segment-2', index: 1, status: 'previewing' as const, readiness: 'tagging' as const }
        ],
        currentSegment: {
          id: currentSegmentId,
          items: currentSegmentId === 'segment-1'
            ? [{ aid: 1, title: 'Done', sourceFolderIds: ['source'] }]
            : [{ aid: 2, title: 'Waiting', sourceFolderIds: ['source'] }]
        },
        classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'deepseek' } }
      })),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: any) => { checkpoint = structuredClone(next) })
    }
    const generate = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: false }]
      }),
      generate
    })

    await expect(service.organizeAllSegments('100')).resolves.toMatchObject({
      deferredSegmentCount: 1,
      progress: { totalChunks: 1, completedChunks: 1, totalVideoCount: 1, successfulVideoCount: 1, failedVideoCount: 0 }
    })
    expect(generate).not.toHaveBeenCalled()
    expect(checkpoint).toMatchObject({
      segmentWork: [{ segmentId: 'segment-1', aids: [1] }],
      totalVideoCount: 1,
      successfulAids: [1], pendingAids: [], failedAids: [],
      completedSegmentIds: ['segment-1'], waitingSegmentIds: ['segment-2'], canceled: false
    })
  })

  it('cancels a durable all-batch intent while it is waiting for tags', async () => {
    let checkpoint: {
      workspaceId: string
      mode: 'all'
      scope: 'all'
      completedSegmentIds: string[]
      waitingSegmentIds: string[]
      canceled: boolean
    } | null = null
    const snapshot = () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'tagging' as const }
      ],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Ready', sourceFolderIds: ['source'] }] },
      classifications: {}
    })
    const coordinator = {
      getSnapshot: vi.fn(async () => snapshot()),
      selectSegment: vi.fn(),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: typeof checkpoint) => { checkpoint = structuredClone(next) })
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: false }] }),
      generate: vi.fn(async () => ({
        kind: 'favorite-archive-organize' as const,
        results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }],
        keywordSuggestions: []
      }))
    })

    await service.organizeAllSegments('100')
    const reconstructedService = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: false }] }),
      generate: vi.fn()
    })
    await expect(reconstructedService.cancelPendingAllSegments('100')).resolves.toBe(true)
    await vi.waitFor(() => expect(checkpoint).toMatchObject({ canceled: true, waitingSegmentIds: ['segment-2'] }))
    await expect(reconstructedService.resumePendingAllSegments('100', ['segment-2'])).resolves.toBeNull()
  })

  it('does not auto-resume duplicate ready notifications after service reconstruction', async () => {
    let checkpoint = {
      workspaceId: 'workspace-1', mode: 'all' as const, scope: 'all' as const,
      completedSegmentIds: ['segment-1'], waitingSegmentIds: ['segment-2'], canceled: false
    }
    const snapshot = () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'ready' as const }
      ],
      currentSegment: { id: 'segment-2', items: [{ aid: 2, title: 'Ready', sourceFolderIds: ['source'] }] },
      classifications: {}
    })
    const coordinator = {
      getSnapshot: vi.fn(async () => snapshot()),
      selectSegment: vi.fn(),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({}),
      getDeepSeekRunCheckpoint: vi.fn(async () => checkpoint),
      setDeepSeekRunCheckpoint: vi.fn(async (_accountMid: string, next: typeof checkpoint | null) => {
        if (next) checkpoint = structuredClone(next)
      })
    }
    const generate = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: false }] }),
      generate
    })

    await expect(service.resumePendingAllSegments('100', ['segment-2'])).resolves.toBeNull()
    await expect(service.resumePendingAllSegments('100', ['segment-2'])).resolves.toBeNull()
    expect(generate).not.toHaveBeenCalled()
  })
})
