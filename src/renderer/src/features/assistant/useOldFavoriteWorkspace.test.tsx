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

  it('sends a whole DeepSeek result as one constrained workspace command', async () => {
    const command = vi.fn().mockResolvedValue(workspace('100'))
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => {
      await result.current.applyDeepSeekClassifications([
        { aid: 2_001, targetLedgerIds: ['knowledge'] },
        { aid: 2_002, targetLedgerIds: ['technology'] }
      ])
    })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', {
      type: 'apply-classifications',
      source: 'deepseek',
      assignments: [
        { aid: 2_001, targetLedgerIds: ['knowledge'] },
        { aid: 2_002, targetLedgerIds: ['technology'] }
      ]
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

  it('starts only the already frozen Bilibili plan through a payload-free command', async () => {
    const command = vi.fn().mockResolvedValue({ ...workspace('100'), status: 'executing' as const })
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    const { result } = renderHook(() => useOldFavoriteWorkspace('100'))

    await act(async () => { await result.current.executeFrozenBilibiliPlan() })

    expect(command).toHaveBeenCalledExactlyOnceWith('100', { type: 'execute-frozen-bilibili-plan' })
    expect(result.current.snapshot).toMatchObject({ status: 'executing' })
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
