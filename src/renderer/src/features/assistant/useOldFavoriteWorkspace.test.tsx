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
})
