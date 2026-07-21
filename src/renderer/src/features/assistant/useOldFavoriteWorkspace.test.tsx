import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useOldFavoriteWorkspace } from './useOldFavoriteWorkspace'

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
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useOldFavoriteWorkspace', () => {
  it('opens the compact workspace snapshot for the active account', async () => {
    const open = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop

    const { result } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' }
    })

    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('100')))
    expect(open).toHaveBeenCalledExactlyOnceWith('100')
    expect(result.current.snapshot).not.toHaveProperty('baseline')
  })

  it('clears its snapshot without an account or desktop bridge', async () => {
    const open = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
    const { result, rerender } = renderHook(({ accountMid }) => useOldFavoriteWorkspace(accountMid), {
      initialProps: { accountMid: '100' }
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
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
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
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => {
      expect(result.current.snapshot).toBeNull()
      expect(result.current.loading).toBe(false)
    })
    expect(open).toHaveBeenCalledExactlyOnceWith('100')
  })

  it('clears the latest snapshot when the desktop bridge rejects', async () => {
    const open = vi.fn().mockRejectedValue(new Error('workspace unavailable'))
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
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
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await waitFor(() => expect(result.current.snapshot).toEqual(workspace('100')))
    await act(async () => { await result.current.refresh() })

    expect(open).toHaveBeenCalledTimes(2)
    expect(result.current.snapshot).toMatchObject({ continuationCount: 3 })
  })

  it('keeps polling a previewing workspace while tag enrichment is running without blocking interaction', async () => {
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
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(result.current.loading).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
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
    } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    let pendingCommand!: Promise<unknown>
    act(() => { pendingCommand = result.current.startScan() })
    expect(result.current.loading).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
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
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
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
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as typeof window.bilimiDesktop
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
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.startScan('full') })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'start-scan', mode: 'full' })
    expect(result.current.snapshot).toEqual(workspace('100'))
  })

  it('sends source selection as a constrained workspace command', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.selectSourceFolders(['source-a', 'source-b']) })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', {
      type: 'select-source-folders', folderIds: ['source-a', 'source-b']
    })
  })

  it('sends current-segment changes and manual classifications as constrained workspace commands', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
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
    window.bilimiDesktop = { organizeOldFavoriteWorkspaceDeepSeekV1: organize } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('low-confidence-and-unclassified') })

    expect(organize).toHaveBeenCalledExactlyOnceWith('100', 'low-confidence-and-unclassified')
    expect(result.current.snapshot).toEqual(workspace('100'))
  })

  it('requests optional Bilibili mirror clearing only with a full reorganization scan', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.startScan('full', { clearBilibiliMirror: true }) })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'start-scan', mode: 'full', clearBilibiliMirror: true })
  })

  it('renders main-process DeepSeek chunk progress before the final result returns', async () => {
    const pending = deferred<{ snapshot: ReturnType<typeof workspace>; progress: { totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }; referencedConstraintLedgerNames: string[]; failures: [] }>()
    let publishProgress: ((progress: { accountMid: string; totalChunks: number; completedChunks: number; totalVideoCount: number; successfulVideoCount: number; failedVideoCount: number }) => void) | undefined
    window.bilimiDesktop = {
      organizeOldFavoriteWorkspaceDeepSeekV1: vi.fn().mockReturnValue(pending.promise),
      onOldFavoriteWorkspaceDeepSeekProgress: (callback) => { publishProgress = callback; return vi.fn() }
    } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    act(() => { void result.current.organizeCurrentSegmentWithDeepSeek('all') })
    await waitFor(() => expect(publishProgress).toBeTypeOf('function'))
    act(() => { publishProgress?.({ accountMid: '100', totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }) })

    expect(result.current.deepSeekFeedback).toMatchObject({
      status: 'running', progress: { totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 }
    })
  })

  it('reports a visible DeepSeek failure when its narrow bridge is unavailable', async () => {
    window.bilimiDesktop = {} as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.organizeCurrentSegmentWithDeepSeek('unclassified-only') })

    expect(result.current.deepSeekFeedback).toEqual({
      status: 'failed', message: 'DeepSeek 整理暂不可用，请稍后重试。'
    })
  })

  it('sends undo and redo as payload-free constrained workspace commands', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.undoClassification() })
    await act(async () => { await result.current.redoClassification() })

    expect(command).toHaveBeenNthCalledWith(1, '100', { type: 'undo-classification' })
    expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'redo-classification' })
  })

  it('freezes Bilibili execution without allowing the renderer to supply operations', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'frozen' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.freezeBilibiliExecution() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'freeze-bilibili-execution' })
    expect(result.current.snapshot).toMatchObject({ status: 'frozen' })
  })

  it('saves the current segment locally through a payload-free workspace command', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'completed' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.saveCurrentSegmentLocally() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'save-current-segment-locally' })
    expect(result.current.snapshot).toMatchObject({ status: 'completed' })
  })

  it('keeps a mapped execution failure visible instead of silently swallowing a rejected confirmation', async () => {
    const command = vi.fn().mockRejectedValue(new Error('remote-target-unbound'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.confirmAndExecuteBilibiliPlan() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'confirm-and-execute-bilibili-plan' })
    expect(result.current.executionError).toBe('本轮目标收藏夹尚未同步到 B 站，请确认同步后重试。')
    expect(result.current.loading).toBe(false)
  })

  it('explains an unavailable remote folder inventory after confirmation instead of showing the generic plan error', async () => {
    const command = vi.fn().mockRejectedValue(new Error('Favorite repository remote folder inventory is unavailable.'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.confirmAndExecuteBilibiliPlan() })

    expect(result.current.executionError).toBe('无法读取 B 站收藏夹列表，请保持已登录的 B 站页面打开后重试。')
  })

  it('explains an ambiguous remote folder target after confirmation instead of showing the generic plan error', async () => {
    const command = vi.fn().mockRejectedValue(new Error('Favorite repository remote shard title is ambiguous.'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.confirmAndExecuteBilibiliPlan() })

    expect(result.current.executionError).toBe('B 站中存在多个同名目标收藏夹，请整理重名收藏夹后重试。')
  })

  it('starts only the already frozen Bilibili plan through a payload-free command', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'executing' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.executeFrozenBilibiliPlan() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'execute-frozen-bilibili-plan' })
    expect(result.current.snapshot).toMatchObject({ status: 'executing' })
  })

  it('keeps execution pending and refreshes the compact remote status while a sync command is in flight', async () => {
    vi.useRealTimers()
    const pending = deferred<ReturnType<typeof workspace>>()
    const command = vi.fn().mockReturnValue(pending.promise)
    const open = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'executing' as const })
    window.bilimiDesktop = {
      commandOldFavoriteWorkspaceV1: command,
      openOldFavoriteWorkspaceV1: open
    } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    let execution!: Promise<unknown>
    act(() => { execution = result.current.executeFrozenBilibiliPlan() })

    await waitFor(() => expect(result.current.loading).toBe(true))
    await waitFor(() => expect(open).toHaveBeenCalled())
    pending.resolve({ ...workspace('100'), status: 'completed' as const })
    await act(async () => { await execution })
    expect(result.current.loading).toBe(false)
  })

  it('exposes explicit reconciliation and non-binding resume commands', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'reconciling' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.reconcileFrozenBilibiliPlan() })
    await act(async () => { await result.current.resumeReconciledBilibiliPlan() })

    expect(command).toHaveBeenNthCalledWith(1, '100', { type: 'reconcile-frozen-bilibili-plan' })
    expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'resume-reconciled-bilibili-plan' })
  })
})
