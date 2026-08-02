import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useOldFavoriteWorkspace } from './useOldFavoriteWorkspace'
import { toDeepSeekFeedbackView } from './oldFavoriteDeepSeekFeedbackModel'

const workspace = (accountMid: string) => ({
  version: 1 as const,
  accountMid,
  workspaceId: `workspace-${accountMid}`,
  status: 'scanning' as const,
  mode: 'incremental' as const,
  segmentSize: 2000,
  hasMultipleSegments: false,
  continuationCount: 0,
  segments: [],
  currentSegment: null,
  classifications: {},
  history: { cursor: 0, length: 0 },
  scan: { phase: 'inventory' as const, failureCount: 0 },
  sourceFolders: []
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

const recommendationWorkspace = (adoptedCandidateIds: string[] = []) => ({
  ...workspace('100'),
  status: 'previewing' as const,
  scan: { phase: 'complete' as const, failureCount: 0 },
  recommendations: {
    candidates: [
      { id: 'author-a', displayName: 'A', kind: 'author' as const, count: 2, reason: 'A' },
      { id: 'author-b', displayName: 'B', kind: 'author' as const, count: 2, reason: 'B' },
      { id: 'tag-c', displayName: 'C', kind: 'tag' as const, count: 2, reason: 'C' }
    ],
    adoptedCandidateIds
  }
})

describe('useOldFavoriteWorkspace', () => {
  it('starts an explicit selected-video workspace without using the account scan command', async () => {
    const selected = {
      ...recommendationWorkspace(),
      mode: 'full' as const,
      scope: { kind: 'selection' as const, aids: [1, 3] }
    }
    const command = vi.fn().mockResolvedValue(selected)
    window.bilimiDesktop = {
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.startSelectedReorganization([3, 1, 3]) })

    expect(command).toHaveBeenCalledWith('100', { type: 'start-selected-reorganization', aids: [1, 3] })
    expect(result.current.snapshot).toMatchObject({ scope: { kind: 'selection', aids: [1, 3] } })
  })

  it('tracks scoped draft-rule analysis progress and cancels it without setting global loading', async () => {
    let publishProgress: ((progress: {
      accountMid: string
      workspaceId: string
      analysisId: string
      completedItemCount: number
      totalItemCount: number
    }) => void) | undefined
    const pending = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn((_accountMid: string, value: { type?: string }) => {
      if (value.type === 'save-draft-ledger-rule') return pending.promise
      return Promise.resolve(recommendationWorkspace())
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace()),
      commandOldFavoriteWorkspaceV1: command,
      onOldFavoriteWorkspaceRuleAnalysisProgress: (callback: NonNullable<typeof publishProgress>) => {
        publishProgress = callback
        return vi.fn()
      }
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ status: 'previewing' }))

    let saving!: Promise<unknown>
    act(() => {
      saving = result.current.saveDraftLedgerRule({
        ledgerId: 'custom-music', title: '音乐', keywords: ['音乐'], ruleType: 'keyword'
      })
    })
    await waitFor(() => expect(result.current.draftRuleAnalysis?.status).toBe('running'))
    expect(result.current.loading).toBe(false)
    const analysisId = result.current.draftRuleAnalysis!.analysisId
    expect(command).toHaveBeenCalledWith('100', {
      type: 'save-draft-ledger-rule', analysisId,
      ledgerId: 'custom-music', title: '音乐', keywords: ['音乐'], ruleType: 'keyword'
    })

    act(() => publishProgress?.({
      accountMid: '100', workspaceId: 'workspace-100', analysisId: 'stale-analysis',
      completedItemCount: 999, totalItemCount: 999
    }))
    expect(result.current.draftRuleAnalysis).toMatchObject({ completedItemCount: 0, totalItemCount: 0 })
    act(() => publishProgress?.({
      accountMid: '100', workspaceId: 'workspace-100', analysisId,
      completedItemCount: 128, totalItemCount: 2_000
    }))
    expect(result.current.draftRuleAnalysis).toMatchObject({ completedItemCount: 128, totalItemCount: 2_000 })

    act(() => { void result.current.cancelDraftLedgerRuleAnalysis() })
    expect(result.current.draftRuleAnalysis?.status).toBe('canceling')
    expect(command).toHaveBeenCalledWith('100', {
      type: 'cancel-draft-ledger-rule-analysis', analysisId
    })
    await act(async () => pending.reject(new Error('Old favorite ledger rule analysis canceled.')))
    await act(async () => { await saving })
    expect(result.current.draftRuleAnalysis).toBeNull()
    expect(result.current.draftRuleAnalysisError).toBeNull()
  })

  it('publishes a completed draft-rule snapshot and ignores progress after the active analysis changes', async () => {
    let publishProgress: ((progress: {
      accountMid: string
      workspaceId: string
      analysisId: string
      completedItemCount: number
      totalItemCount: number
    }) => void) | undefined
    const completed = {
      ...recommendationWorkspace(),
      recommendations: {
        candidates: [{ id: 'custom-music', displayName: 'bilimi·音乐', kind: 'series' as const, count: 1, reason: 'local' }],
        adoptedCandidateIds: ['custom-music']
      }
    }
    const command = vi.fn().mockResolvedValue(completed)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace()),
      commandOldFavoriteWorkspaceV1: command,
      onOldFavoriteWorkspaceRuleAnalysisProgress: (callback: NonNullable<typeof publishProgress>) => {
        publishProgress = callback
        return vi.fn()
      }
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ status: 'previewing' }))

    await act(async () => {
      await result.current.saveDraftLedgerRule({
        ledgerId: 'custom-music', title: '音乐', keywords: ['音乐'], ruleType: 'keyword'
      })
    })

    expect(result.current.snapshot).toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-music'] }
    })
    expect(result.current.draftRuleAnalysis).toBeNull()
    act(() => publishProgress?.({
      accountMid: '100', workspaceId: 'workspace-100', analysisId: 'finished-analysis',
      completedItemCount: 2_000, totalItemCount: 2_000
    }))
    expect(result.current.draftRuleAnalysis).toBeNull()
  })

  it('prepares the current recommendation draft with progress before returning a preview snapshot', async () => {
    let publishProgress: ((progress: { accountMid: string; workspaceId: string; completedItemCount: number; totalItemCount: number }) => void) | undefined
    const pending = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn((_, value: { type?: string }) => value.type === 'prepare-recommendation-preview'
      ? pending.promise
      : Promise.resolve(recommendationWorkspace(['author-a'])))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace()),
      commandOldFavoriteWorkspaceV1: command,
      onOldFavoriteWorkspacePreviewPreparationProgress: (callback: NonNullable<typeof publishProgress>) => {
        publishProgress = callback
        return vi.fn()
      }
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ status: 'previewing' }))
    act(() => result.current.setRecommendedCandidates(['author-a']))
    await waitFor(() => expect(result.current.recommendationSaving).toBe(false))

    let preparation!: Promise<unknown>
    act(() => { preparation = result.current.prepareRecommendationPreview() })
    await waitFor(() => expect(result.current.previewPreparationRunning).toBe(true))
    act(() => publishProgress?.({ accountMid: '100', workspaceId: 'workspace-100', completedItemCount: 128, totalItemCount: 2_000 }))
    expect(result.current.previewPreparationProgress).toEqual({ completedItemCount: 128, totalItemCount: 2_000 })
    await act(async () => pending.resolve(recommendationWorkspace(['author-a'])))
    await act(async () => { await preparation })
    expect(command).toHaveBeenLastCalledWith('100', {
      type: 'prepare-recommendation-preview', candidateIds: ['author-a']
    })
    expect(result.current.previewPreparationRunning).toBe(false)
  })

  it('cancels and stales an active preview preparation when the recommendation draft changes', async () => {
    const pending = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn((_, value: { type?: string }) => value.type === 'prepare-recommendation-preview'
      ? pending.promise
      : Promise.resolve(recommendationWorkspace(value.type === 'set-recommended-candidates' ? ['author-b'] : [])))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace(['author-a'])),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.recommendedCandidateIds).toEqual(['author-a']))

    let preparation!: Promise<unknown>
    act(() => { preparation = result.current.prepareRecommendationPreview() })
    await waitFor(() => expect(result.current.previewPreparationRunning).toBe(true))
    act(() => result.current.setRecommendedCandidates(['author-b']))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'cancel-recommendation-preview-preparation' }))
    await act(async () => pending.resolve(recommendationWorkspace(['author-a'])))
    await act(async () => { await preparation })
    expect(result.current.recommendedCandidateIds).toEqual(['author-b'])
  })

  it('cancels an active preview preparation when the account changes', async () => {
    const pending = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn((accountMid: string, value: { type?: string }) =>
      value.type === 'prepare-recommendation-preview'
        ? pending.promise
        : Promise.resolve({ ...recommendationWorkspace(), accountMid, workspaceId: `workspace-${accountMid}` }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn((accountMid: string) => Promise.resolve({
        ...recommendationWorkspace(), accountMid, workspaceId: `workspace-${accountMid}`
      })),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result, rerender } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' }
    })
    await waitFor(() => expect(result.current.snapshot?.workspaceId).toBe('workspace-100'))
    act(() => { void result.current.prepareRecommendationPreview() })
    await waitFor(() => expect(result.current.previewPreparationRunning).toBe(true))

    rerender({ accountMid: '200' })

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'cancel-recommendation-preview-preparation'
    }))
    await act(async () => pending.resolve(recommendationWorkspace()))
  })

  it('does not start a stale preview preparation after the account changes while recommendation saving is pending', async () => {
    const save = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn((accountMid: string, value: { type?: string }) =>
      value.type === 'set-recommended-candidates'
        ? save.promise
        : Promise.resolve({ ...recommendationWorkspace(), accountMid, workspaceId: `workspace-${accountMid}` }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn((accountMid: string) => Promise.resolve({
        ...recommendationWorkspace(), accountMid, workspaceId: `workspace-${accountMid}`
      })),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result, rerender } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' }
    })
    await waitFor(() => expect(result.current.snapshot?.workspaceId).toBe('workspace-100'))
    act(() => result.current.setRecommendedCandidates(['author-a']))
    act(() => { void result.current.prepareRecommendationPreview() })

    rerender({ accountMid: '200' })
    await waitFor(() => expect(result.current.snapshot?.workspaceId).toBe('workspace-200'))

    expect(command).not.toHaveBeenCalledWith('100', expect.objectContaining({ type: 'prepare-recommendation-preview' }))
    await act(async () => save.resolve(recommendationWorkspace(['author-a'])))
  })

  it('accumulates functional recommendation changes from the latest optimistic draft', async () => {
    const pending = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn().mockReturnValue(pending.promise)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace()),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ status: 'previewing' }))

    act(() => {
      result.current.updateRecommendedCandidates((current) => [...current, 'author-a'])
      result.current.updateRecommendedCandidates((current) => [...current, 'author-b'])
      result.current.updateRecommendedCandidates((current) => [...current, 'tag-c'])
    })

    expect(result.current.recommendedCandidateIds).toEqual(['author-a', 'author-b', 'tag-c'])
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('publishes recommendation choices immediately and coalesces rapid changes to the latest set', async () => {
    const first = deferred<ReturnType<typeof recommendationWorkspace>>()
    const second = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace()),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ status: 'previewing' }))

    act(() => result.current.setRecommendedCandidates(['author-a']))
    expect(result.current.recommendedCandidateIds).toEqual(['author-a'])
    expect(result.current.recommendationSaving).toBe(true)
    act(() => result.current.setRecommendedCandidates(['author-b']))
    act(() => result.current.setRecommendedCandidates(['author-b', 'tag-c']))
    expect(result.current.recommendedCandidateIds).toEqual(['author-b', 'tag-c'])
    expect(command).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve(recommendationWorkspace(['author-a'])))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
    expect(command).toHaveBeenLastCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: ['author-b', 'tag-c']
    })
    await act(async () => second.resolve(recommendationWorkspace(['author-b', 'tag-c'])))
    await waitFor(() => expect(result.current.recommendationSaving).toBe(false))
    expect(result.current.recommendedCandidateIds).toEqual(['author-b', 'tag-c'])
  })

  it('publishes the latest authoritative workspace snapshot when a recommendation delta returns', async () => {
    const opened = recommendationWorkspace()
    const saved = {
      ...recommendationWorkspace(['author-a']),
      currentSegment: {
        id: 'segment-1',
        aids: [1],
        items: [{ aid: 1, title: 'unexpected replacement', sourceFolderIds: [] }]
      }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(opened),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(saved)
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toBe(opened))

    act(() => result.current.setRecommendedCandidates(['author-a']))

    await waitFor(() => expect(result.current.recommendationSaving).toBe(false))
    expect(result.current.snapshot).toBe(saved)
    expect(result.current.recommendedCandidateIds).toEqual(['author-a'])
  })

  it('rolls recommendation choices back to the authoritative snapshot when saving fails', async () => {
    const pending = deferred<ReturnType<typeof recommendationWorkspace>>()
    const command = vi.fn().mockReturnValue(pending.promise)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(recommendationWorkspace(['author-a'])),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.recommendedCandidateIds).toEqual(['author-a']))

    act(() => result.current.setRecommendedCandidates([]))
    expect(result.current.recommendedCandidateIds).toEqual([])
    await act(async () => pending.reject(new Error('save failed')))

    await waitFor(() => expect(result.current.recommendationSaving).toBe(false))
    expect(result.current.recommendedCandidateIds).toEqual(['author-a'])
    expect(result.current.recommendationError).toBeTruthy()
  })

  it('opens the compact workspace snapshot for the active account', async () => {
    const open = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop

    const { result } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' as string | undefined }
    })

    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('100')))
    expect(open).toHaveBeenCalledExactlyOnceWith('100')
    expect(result.current.snapshot).not.toHaveProperty('baseline')
  })

  it('treats a new account with no organization round as an idle snapshot, not a read error', async () => {
    const open = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => {
      expect(result.current.snapshot).toBeNull()
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.lastError).toBeNull()
    expect(open).toHaveBeenCalledExactlyOnceWith('100')
  })

  it('clears its snapshot without an account or desktop bridge', async () => {
    const open = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result, rerender } = renderHook(({ accountMid }: { accountMid?: string }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' as string | undefined }
    })

    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('100')))
    Reflect.deleteProperty(window, 'bilimiDesktop')
    rerender({ accountMid: undefined })
    await waitFor(() => {
      expect(result.current.snapshot).toBeNull()
      expect(result.current.loading).toBe(false)
    })
  })

  it('does not let a previous account response overwrite the latest account', async () => {
    const first = deferred<ReturnType<typeof workspace>>()
    const second = deferred<ReturnType<typeof workspace>>()
    const open = vi.fn((accountMid: string) => accountMid === '100' ? first.promise : second.promise)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result, rerender } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' }
    })

    rerender({ accountMid: '200' })
    await act(async () => { second.resolve(workspace('200')) })
    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('200')))
    await act(async () => { first.resolve(workspace('100')) })

    expect(result.current.snapshot).toEqual(workspace('200'))
    expect(result.current.loading).toBe(false)
  })

  it('does not publish a snapshot returned for a different account', async () => {
    const open = vi.fn().mockResolvedValue(workspace('200'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => {
      expect(result.current.snapshot).toBeNull()
      expect(result.current.loading).toBe(false)
    })
    expect(open).toHaveBeenCalledExactlyOnceWith('100')
  })

  it('clears the latest snapshot when the desktop bridge rejects', async () => {
    const open = vi.fn().mockRejectedValue(new Error('workspace unavailable'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => {
      expect(result.current.snapshot).toBeNull()
      expect(result.current.loading).toBe(false)
    })
    expect(open).toHaveBeenCalledExactlyOnceWith('100')
  })

  it('refreshes the active account snapshot on demand', async () => {
    const open = vi.fn()
      .mockResolvedValueOnce(workspace('100'))
      .mockResolvedValueOnce({ ...workspace('100'), continuationCount: 3 })
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('100')))
    await act(async () => { await result.current.refresh() })

    expect(open).toHaveBeenCalledTimes(2)
    expect(result.current.snapshot).toMatchObject({ continuationCount: 3 })
  })

  it.each([
    ['returns no workspace', () => Promise.resolve(null)],
    ['rejects', () => Promise.reject(new Error('workspace unavailable'))],
    ['returns a recovery marker', () => Promise.resolve({
      accountMid: '100',
      recovery: { kind: 'corrupt-workspace' as const, reason: 'invalid-workspace' }
    })]
  ])('preserves the visible snapshot when a background refresh %s', async (_label, reload) => {
    const initial = { ...workspace('100'), status: 'previewing' as const }
    const open = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(reload)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect(result.current.snapshot).toEqual(initial))
    await act(async () => { await result.current.refresh(true) })

    expect(open).toHaveBeenCalledTimes(2)
    expect(result.current.snapshot).toEqual(initial)
    expect(result.current.backgroundRefreshing).toBe(false)
  })

  it('returns null when a foreground command invalidates a pending background refresh', async () => {
    const polling = deferred<ReturnType<typeof workspace>>()
    const open = vi.fn()
      .mockResolvedValueOnce(workspace('100'))
      .mockReturnValueOnce(polling.promise)
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), continuationCount: 2 })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('100')))
    let background!: Promise<unknown>
    act(() => { background = result.current.refresh(true) })
    await act(async () => { await result.current.autoClassifyCurrentSegment() })
    await act(async () => polling.resolve({ ...workspace('100'), continuationCount: 1 }))

    await expect(background).resolves.toBeNull()
    expect(result.current.snapshot).toMatchObject({ continuationCount: 2 })
  })

  it('uses a low-frequency visible fallback while tag enrichment is running without blocking interaction', async () => {
    vi.useFakeTimers()
    const polling = deferred<ReturnType<typeof workspace>>()
    const enrichingWorkspace = {
      ...workspace('100'),
      status: 'previewing' as const,
      scan: { phase: 'complete' as const, failureCount: 0 },
      tagEnrichment: { status: 'running' as const, totalItemCount: 2, completedItemCount: 1, pendingItemCount: 1 }
    }
    const open = vi.fn()
      .mockResolvedValueOnce(enrichingWorkspace)
      .mockReturnValueOnce(polling.promise)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(result.current.loading).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(3_999) })
    expect(open).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(open).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
    expect(result.current.backgroundRefreshing).toBe(true)

    await act(async () => { polling.resolve(workspace('100')) })
    expect(result.current.backgroundRefreshing).toBe(false)
  })

  it('does not let background polling strand a foreground command in loading', async () => {
    vi.useFakeTimers()
    const commandResult = deferred<ReturnType<typeof workspace>>()
    const open = vi.fn().mockResolvedValue(workspace('100'))
    const command = vi.fn().mockReturnValue(commandResult.promise)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    let pendingCommand!: Promise<unknown>
    act(() => { pendingCommand = result.current.startScan() })
    expect(result.current.loading).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    commandResult.resolve(workspace('100'))
    await act(async () => { await pendingCommand })

    expect(result.current.loading).toBe(false)
    vi.useRealTimers()
  })

  it('keeps loading until overlapping foreground commands have both finished', async () => {
    const first = deferred<ReturnType<typeof workspace>>()
    const second = deferred<ReturnType<typeof workspace>>()
    const command = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    let firstCommand!: Promise<unknown>
    let secondCommand!: Promise<unknown>
    act(() => {
      firstCommand = result.current.startScan()
      secondCommand = result.current.autoClassifyCurrentSegment()
    })
    second.resolve(workspace('100'))
    await act(async () => { await secondCommand })
    expect(result.current.loading).toBe(true)

    first.resolve(workspace('100'))
    await act(async () => { await firstCommand })
    expect(result.current.loading).toBe(false)
  })

  it('does not let an abandoned prior-account request keep the new account loading', async () => {
    const first = deferred<ReturnType<typeof workspace>>()
    const second = deferred<ReturnType<typeof workspace>>()
    const open = vi.fn((accountMid: string) => accountMid === '100' ? first.promise : second.promise)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop
    const { result, rerender } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' }
    })

    rerender({ accountMid: '200' })
    await act(async () => { second.resolve(workspace('200')) })

    expect(result.current.snapshot).toEqual(workspace('200'))
    expect(result.current.loading).toBe(false)
  })

  it('starts a compact scan through the constrained workspace command', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.startScan('full') })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'start-scan', mode: 'full' })
    expect(result.current.snapshot).toEqual(workspace('100'))
  })

  it('sends source selection as a constrained workspace command', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.selectSourceFolders(['source-a', 'source-b']) })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', {
      type: 'select-source-folders', folderIds: ['source-a', 'source-b']
    })
  })

  it('sends current-segment changes and manual classifications as constrained workspace commands', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.selectSegment('segment-2') })
    await act(async () => {
      await result.current.applyManualClassifications([{ aid: 2_001, targetLedgerIds: ['music'] }])
    })

    expect(command).toHaveBeenNthCalledWith(1, '100', { type: 'select-segment', segmentId: 'segment-2' })
    expect(command).toHaveBeenNthCalledWith(2, '100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 2_001, targetLedgerIds: ['music'] }]
    })
  })

  it('runs DeepSeek through the payload-free current-segment bridge', async () => {
    const organize = vi.fn().mockResolvedValue({
      snapshot: workspace('100'),
      progress: { totalChunks: 1, completedChunks: 1, totalVideoCount: 1, successfulVideoCount: 1, failedVideoCount: 0 },
      failures: []
    })
    window.bilimiDesktop = { organizeOldFavoriteWorkspaceDeepSeekV1: organize } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('low-confidence-and-unclassified') })

    expect(organize).toHaveBeenCalledExactlyOnceWith('100', 'low-confidence-and-unclassified')
    expect(result.current.snapshot).toEqual(workspace('100'))
  })

  it('keeps all-batch DeepSeek in a waiting state until later tag batches resume', async () => {
    const organize = vi.fn().mockResolvedValue({
      snapshot: workspace('100'),
      progress: { totalChunks: 1, completedChunks: 1, totalVideoCount: 20, successfulVideoCount: 20, failedVideoCount: 0 },
      failures: [],
      deferredSegmentCount: 1
    })
    window.bilimiDesktop = { organizeOldFavoriteWorkspaceDeepSeekV1: organize } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('low-confidence-and-unclassified', 'all') })

    expect(result.current.deepSeekFeedback).toMatchObject({
      status: 'waiting',
      message: expect.stringContaining('标签补取完成后会自动继续')
    })
  })

  it('reports background all-batch completion when polling observes the checkpoint clear', async () => {
    const waitingSnapshot = {
      ...workspace('100'),
      deepSeekRun: {
        mode: 'all' as const, scope: 'all' as const, status: 'waiting' as const,
        completedSegmentCount: 1, waitingSegmentCount: 1
      }
    }
    const organize = vi.fn().mockResolvedValue({
      snapshot: waitingSnapshot,
      progress: { totalChunks: 1, completedChunks: 1, totalVideoCount: 20, successfulVideoCount: 20, failedVideoCount: 0 },
      failures: [], deferredSegmentCount: 1
    })
    const open = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = {
      organizeOldFavoriteWorkspaceDeepSeekV1: organize,
      openOldFavoriteWorkspaceV1: open
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('all', 'all') })
    expect(result.current.deepSeekFeedback?.status).toBe('waiting')
    await act(async () => { await result.current.refresh(true) })

    expect(result.current.deepSeekFeedback).toMatchObject({
      status: 'completed',
      message: expect.stringContaining('本轮所有批次已在后台整理完成')
    })
  })

  it('maps a restarted durable plan to running and restores cancellation immediately', async () => {
    const restarted = {
      ...workspace('100'),
      deepSeekRun: { mode: 'all' as const, scope: 'all' as const, status: 'running' as const, completedSegmentCount: 1, waitingSegmentCount: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(restarted)
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect(result.current.snapshot).toEqual(restarted))

    expect(result.current.deepSeekFeedback).toMatchObject({ status: 'running' })
    expect(result.current.deepSeekCancelRequested).toBe(false)
    expect(toDeepSeekFeedbackView(result.current.deepSeekFeedback!, result.current.deepSeekCancelRequested).action).toBe('cancel')
  })

  it('keeps an Electron-wrapped workspace change error distinct from DeepSeek service settings failures', async () => {
    const organize = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'old-favorite-workspace-v1:deepseek-current-segment': Error: Old favorite workspace changed while DeepSeek was running."
    ))
    window.bilimiDesktop = { organizeOldFavoriteWorkspaceDeepSeekV1: organize } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('all') })

    expect(result.current.deepSeekFeedback).toEqual({
      status: 'failed',
      message: '整理期间草稿发生了变化，本次结果未覆盖现有改动；请确认当前批次后重试。'
    })
  })

  it('explains an Electron-wrapped selected-source validation failure in Chinese', async () => {
    const organize = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'old-favorite-workspace-v1:deepseek-current-segment': Error: Old favorite workspace classifications must target selected sources."
    ))
    window.bilimiDesktop = { organizeOldFavoriteWorkspaceDeepSeekV1: organize } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('all') })

    expect(result.current.deepSeekFeedback).toEqual({
      status: 'failed',
      message: '整理范围发生了变化，本次结果未覆盖现有改动；请确认已选来源后重试。'
    })
  })

  it('keeps failed DeepSeek batches retryable when a retry transport request rejects', async () => {
    const failure = { chunkIndex: 2, affectedVideoCount: 3, message: 'incomplete current-segment' }
    const organize = vi.fn().mockResolvedValue({
      snapshot: workspace('100'),
      progress: { totalChunks: 2, completedChunks: 2, totalVideoCount: 3, successfulVideoCount: 0, failedVideoCount: 3 },
      failures: [failure]
    })
    const retry = vi.fn().mockRejectedValue(new Error('retry transport unavailable'))
    window.bilimiDesktop = {
      organizeOldFavoriteWorkspaceDeepSeekV1: organize,
      retryOldFavoriteWorkspaceDeepSeekV1: retry
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('all') })
    await act(async () => { await result.current.retryFailedDeepSeekChunks() })

    expect(retry).toHaveBeenCalledExactlyOnceWith('100')
    expect(result.current.deepSeekFeedback).toMatchObject({ status: 'failed', failures: [failure] })
    expect(toDeepSeekFeedbackView(result.current.deepSeekFeedback!, false).action).toBe('retry')
  })

  it('requests the original-classification fallback through the controlled workspace command', async () => {
    const resolved = workspace('100')
    const command = vi.fn().mockResolvedValue(resolved)
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => {
      await result.current.useOriginalClassificationsForFailedDeepSeek()
    })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', {
      type: 'use-original-classifications-for-failed-deepseek'
    })
    expect(result.current.snapshot).toEqual(resolved)
  })

  it('requests cancellation through the workspace command without superseding the DeepSeek result', async () => {
    const pending = deferred<{ snapshot: ReturnType<typeof workspace>; progress: { totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }; failures: []; canceled: true }>()
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = {
      organizeOldFavoriteWorkspaceDeepSeekV1: vi.fn().mockReturnValue(pending.promise),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    act(() => { void result.current.organizeCurrentSegmentWithDeepSeek('all') })
    await waitFor(() => expect(result.current.deepSeekFeedback?.status).toBe('running'))
    await act(async () => { await result.current.cancelCurrentSegmentDeepSeek() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'cancel-deepseek-current-segment' })
    expect(result.current.deepSeekCancelRequested).toBe(true)
    pending.resolve({
      snapshot: workspace('100'), canceled: true,
      progress: { totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }, failures: []
    })
    await waitFor(() => expect(result.current.deepSeekFeedback?.status).toBe('canceled'))
    expect(result.current.snapshot).toEqual(workspace('100'))
  })

  it('requests optional Bilibili mirror clearing only with a full reorganization scan', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.startScan('full', { clearBilibiliMirror: true }) })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'start-scan', mode: 'full', clearBilibiliMirror: true })
  })

  it('renders main-process DeepSeek chunk progress before the final result returns', async () => {
    const pending = deferred<{ snapshot: ReturnType<typeof workspace>; progress: { totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }; referencedConstraintLedgerNames: string[]; failures: [] }>()
    let publishProgress: ((progress: { accountMid: string; workspaceId: string; totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }) => void) | undefined
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({ ...workspace('100'), status: 'previewing' as const }),
      organizeOldFavoriteWorkspaceDeepSeekV1: vi.fn().mockReturnValue(pending.promise),
      onOldFavoriteWorkspaceDeepSeekProgress: (callback: NonNullable<typeof publishProgress>) => { publishProgress = callback; return vi.fn() }
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect((result.current.snapshot && 'status' in result.current.snapshot ? result.current.snapshot.status : undefined)).toBe('previewing'))
    act(() => { void result.current.organizeCurrentSegmentWithDeepSeek('all') })
    await waitFor(() => expect(publishProgress).toBeTypeOf('function'))
    act(() => { publishProgress?.({ accountMid: '100', workspaceId: 'workspace-100', totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }) })

    expect(result.current.deepSeekFeedback).toMatchObject({
      status: 'running', progress: { totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }
    })
  })

  it('clears DeepSeek feedback for a full reorganization and ignores progress from the replaced workspace', async () => {
    const oldWorkspace = { ...workspace('100'), workspaceId: 'workspace-old', status: 'previewing' as const }
    const newWorkspace = { ...workspace('100'), workspaceId: 'workspace-new', status: 'scanning' as const }
    const deepSeek = deferred<{ snapshot: typeof oldWorkspace; progress: { totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }; referencedConstraintLedgerNames: string[]; failures: [] }>()
    let publishProgress: ((progress: { accountMid: string; workspaceId: string; totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }) => void) | undefined
    const command = vi.fn().mockResolvedValue(newWorkspace)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(oldWorkspace),
      organizeOldFavoriteWorkspaceDeepSeekV1: vi.fn().mockReturnValue(deepSeek.promise),
      commandOldFavoriteWorkspaceV1: command,
      onOldFavoriteWorkspaceDeepSeekProgress: (callback: NonNullable<typeof publishProgress>) => { publishProgress = callback; return vi.fn() }
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect(result.current.snapshot?.workspaceId).toBe('workspace-old'))
    await waitFor(() => expect((result.current.snapshot && 'status' in result.current.snapshot ? result.current.snapshot.status : undefined)).toBe('previewing'))
    act(() => { void result.current.organizeCurrentSegmentWithDeepSeek('all') })
    await waitFor(() => expect(result.current.deepSeekFeedback?.status).toBe('running'))

    await act(async () => { await result.current.startScan('full') })
    expect(result.current.deepSeekFeedback).toBeNull()
    expect(result.current.snapshot?.workspaceId).toBe('workspace-new')

    act(() => { publishProgress?.({ accountMid: '100', workspaceId: 'workspace-old', totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }) })
    expect(result.current.deepSeekFeedback).toBeNull()
    expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'full' })
  })

  it('reports a visible DeepSeek failure when its narrow bridge is unavailable', async () => {
    window.bilimiDesktop = {} as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('unclassified-only') })

    expect(result.current.deepSeekFeedback).toEqual({
      status: 'failed', message: 'DeepSeek 整理暂不可用，请稍后重试。'
    })
  })

  it('sends undo and redo as payload-free constrained workspace commands', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.undoClassification() })
    await act(async () => { await result.current.redoClassification() })

    expect(command).toHaveBeenNthCalledWith(1, '100', { type: 'undo-classification' })
    expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'redo-classification' })
  })

  it('freezes Bilibili execution without allowing the renderer to supply operations', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'frozen' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.freezeBilibiliExecution() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'freeze-bilibili-execution' })
    expect(result.current.snapshot).toMatchObject({ status: 'frozen' })
  })

  it('saves the current segment locally through a payload-free workspace command', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'completed' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.saveCurrentSegmentLocally() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'save-current-segment-locally' })
    expect(result.current.snapshot).toMatchObject({ status: 'completed' })
  })

  it('abandons the current pending workspace through a payload-free command', async () => {
    const command = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.abandonCurrentWorkspace() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'abandon-current-workspace' })
    expect(result.current.snapshot).toBeNull()
  })

  it('clears a stale renderer snapshot when abandoning a legacy workspace returns no marker', async () => {
    const open = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'previewing' as const })
    const command = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ status: 'previewing' }))

    await act(async () => { await result.current.abandonCurrentWorkspace() })

    expect(result.current.snapshot).toBeNull()
  })

  it('keeps a mapped execution failure visible instead of silently swallowing a rejected confirmation', async () => {
    const command = vi.fn().mockRejectedValue(new Error('remote-target-unbound'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.confirmAndExecuteBilibiliPlan() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'confirm-and-execute-bilibili-plan' })
    expect(result.current.executionError).toBe('本轮目标收藏夹尚未同步到 B 站，请确认同步后重试。')
    expect(result.current.loading).toBe(false)
  })

  it('asks for a development restart when the renderer calls a command missing from the old main process', async () => {
    const command = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'old-favorite-workspace-v1:command': Error: Old favorite workspace command is invalid."
    ))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.setWholeRunExecutionIntent('bilibili') })

    expect(result.current.executionError).toBe('开发版主进程仍是旧版本，请重启开发项目后再试；本轮整理草稿不会丢失。')
  })

  it('explains an unavailable remote folder inventory after confirmation instead of showing the generic plan error', async () => {
    const command = vi.fn().mockRejectedValue(new Error('Favorite repository remote folder inventory is unavailable.'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.confirmAndExecuteBilibiliPlan() })

    expect(result.current.executionError).toBe('无法读取 B 站收藏夹列表，请保持已登录的 B 站页面打开后重试。')
  })

  it('explains an ambiguous remote folder target after confirmation instead of showing the generic plan error', async () => {
    const command = vi.fn().mockRejectedValue(new Error('Favorite repository remote shard title is ambiguous.'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.confirmAndExecuteBilibiliPlan() })

    expect(result.current.executionError).toBe('B 站中存在多个同名目标收藏夹，请整理重名收藏夹后重试。')
  })

  it('starts only the already frozen Bilibili plan through a payload-free command', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'executing' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.executeFrozenBilibiliPlan() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'execute-frozen-bilibili-plan' })
    expect(result.current.snapshot).toMatchObject({ status: 'executing' })
  })

  it('keeps execution pending and refreshes the compact remote status while a sync command is in flight', async () => {
    vi.useRealTimers()
    const pending = deferred<Awaited<ReturnType<NonNullable<typeof window.bilimiDesktop.commandOldFavoriteWorkspaceV1>>>>()
    const command = vi.fn().mockReturnValue(pending.promise)
    const open = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'executing' as const })
    window.bilimiDesktop = {
      commandOldFavoriteWorkspaceV1: command,
      openOldFavoriteWorkspaceV1: open
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    let execution!: Promise<unknown>
    act(() => { execution = result.current.executeFrozenBilibiliPlan() })

    await waitFor(() => expect(result.current.loading).toBe(true))
    await waitFor(() => expect(open).toHaveBeenCalled())
    pending.resolve({ ...workspace('100'), status: 'completed' as const, scan: { phase: 'complete' as const, failureCount: 0 }, currentSegment: null } as never)
    await act(async () => { await execution })
    expect(result.current.loading).toBe(false)
  })

  it('exposes explicit reconciliation and non-binding resume commands', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'reconciling' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.reconcileFrozenBilibiliPlan() })
    await act(async () => { await result.current.resumeReconciledBilibiliPlan() })

    expect(command).toHaveBeenNthCalledWith(1, '100', { type: 'reconcile-frozen-bilibili-plan' })
    expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'resume-reconciled-bilibili-plan' })
  })

  it('explains when reconciliation completes but the remote result is still unknown', async () => {
    const command = vi.fn().mockResolvedValue({
      ...workspace('100'),
      status: 'reconciling' as const
    })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.reconcileFrozenBilibiliPlan() })

    expect(result.current.executionError).toBe('仍无法确认 B 站中的实际收藏结果，请保持已登录的 B 站页面打开后再次对账；系统不会重复提交。')
  })

  it('keeps the loaded draft when reconciliation returns no snapshot', async () => {
    const reconciling = { ...workspace('100'), status: 'reconciling' as const }
    const command = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(reconciling),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))
    await act(async () => { await result.current.refresh() })

    await act(async () => { await result.current.reconcileFrozenBilibiliPlan() })

    expect(result.current.snapshot).toEqual(reconciling)
    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'reconcile-frozen-bilibili-plan' })
  })
})
