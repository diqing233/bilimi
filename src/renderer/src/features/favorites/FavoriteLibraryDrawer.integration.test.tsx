import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDrawer } from './FavoriteLibraryDrawer'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FavoriteLibraryDrawer integration', () => {
  it('surfaces an active old-favorite scan from the account-scoped repository summary', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 },
        workspace: { id: 'workspace-1', status: 'scanning', baselineRevision: 1, continuationCount: 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, items: []
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(await screen.findByText('正在扫描旧藏')).toBeInTheDocument()
  })

  it('surfaces account-scoped transcription failures in the drawer header', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, items: []
      }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        items: [{ id: 'failed-1', accountMid: '100', title: '失败视频', url: 'https://example.test', status: 'failed', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
        sessionCompletedCount: 0
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(await screen.findByText('1项转写失败')).toBeInTheDocument()
  })

  it('automatically dismisses a successful transcription notice after four seconds', async () => {
    vi.useFakeTimers()
    let onQueueChanged: ((snapshot: { items: Array<Record<string, unknown>>; sessionCompletedCount: number }) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, items: []
      }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ items: [], sessionCompletedCount: 0 }),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        onQueueChanged = callback as typeof onQueueChanged
        return () => undefined
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    act(() => {
      onQueueChanged?.({
        items: [{ id: 'completed-1', accountMid: '100', title: '完成视频', url: 'https://example.test', status: 'completed', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
        sessionCompletedCount: 1
      })
    })

    expect(screen.getByText('本次转写成功 1 项')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText('本次转写成功 1 项')).not.toBeInTheDocument()
  })

  it('does not let a stale initial transcription snapshot replay a completion notice', async () => {
    let resolveInitialQueue: ((snapshot: { items: Array<Record<string, unknown>>; sessionCompletedCount: number }) => void) | undefined
    const initialQueue = new Promise<{ items: Array<Record<string, unknown>>; sessionCompletedCount: number }>((resolve) => {
      resolveInitialQueue = resolve
    })
    let onQueueChanged: ((snapshot: { items: Array<Record<string, unknown>>; sessionCompletedCount: number }) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockReturnValue(initialQueue),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        onQueueChanged = callback as typeof onQueueChanged
        return () => undefined
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await waitFor(() => expect(onQueueChanged).toBeTypeOf('function'))
    const completed = {
      items: [{ id: 'completed-1', accountMid: '100', title: '完成视频', url: 'https://example.test', status: 'completed', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
      sessionCompletedCount: 1
    }
    act(() => { onQueueChanged?.(completed) })
    expect(screen.getByText('本次转写成功 1 项')).toBeInTheDocument()

    await act(async () => { resolveInitialQueue?.({ items: [], sessionCompletedCount: 0 }) })
    act(() => { onQueueChanged?.(completed) })

    expect(screen.getByText('本次转写成功 1 项')).toBeInTheDocument()
    expect(screen.queryByText('本次转写成功 2 项')).not.toBeInTheDocument()
  })

  it('does not show a successful transcription notice for a different account', async () => {
    let onQueueChanged: ((snapshot: { items: Array<Record<string, unknown>>; sessionCompletedCount: number }) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ items: [], sessionCompletedCount: 0 }),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        onQueueChanged = callback as typeof onQueueChanged
        return () => undefined
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    act(() => {
      onQueueChanged?.({
        items: [{ id: 'completed-foreign', accountMid: '200', title: '其他账号视频', url: 'https://example.test', status: 'completed', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
        sessionCompletedCount: 1
      })
    })

    expect(screen.queryByText('本次转写成功 1 项')).not.toBeInTheDocument()
  })

  it('does not revive a completed-transcription notice after switching away from and back to its account', async () => {
    let currentAccountMid = '100'
    let onAccountChanged: (() => void) | undefined
    let onQueueChanged: ((snapshot: { items: Array<Record<string, unknown>>; sessionCompletedCount: number }) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn(() => Promise.resolve(currentAccountMid)),
      onBilibiliAccountChanged: vi.fn((callback) => {
        onAccountChanged = callback
        return () => undefined
      }),
      openFavoriteRepositoryAccount: vi.fn((accountMid) => Promise.resolve({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage: vi.fn((accountMid) => Promise.resolve({ version: 1, accountMid, revision: 1, items: [] })),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ items: [], sessionCompletedCount: 0 }),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        onQueueChanged = callback as typeof onQueueChanged
        return () => undefined
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await waitFor(() => expect(onQueueChanged).toBeTypeOf('function'))
    act(() => {
      onQueueChanged?.({
        items: [{ id: 'completed-1', accountMid: '100', title: '完成视频', url: 'https://example.test', status: 'completed', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
        sessionCompletedCount: 1
      })
    })
    expect(screen.getByText('本次转写成功 1 项')).toBeInTheDocument()

    currentAccountMid = '200'
    act(() => { onAccountChanged?.() })
    await screen.findByLabelText('当前账号：UID：200')
    expect(screen.queryByText('本次转写成功 1 项')).not.toBeInTheDocument()

    currentAccountMid = '100'
    act(() => { onAccountChanged?.() })
    await screen.findByLabelText('当前账号：UID：100')
    expect(screen.queryByText('本次转写成功 1 项')).not.toBeInTheDocument()
  })

  it('keeps three live panes and puts the highest-priority reconciliation notice in the title bar', async () => {
    const getPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1,
      items: [{
        video: { aid: 1, title: '同步失败视频', author: 'UP 主', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' },
        folderIds: [], pendingStates: ['failed']
      }]
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 1,
        syncCounts: { pending: 0, succeeded: 0, failed: 1, 'result-unknown': 0 },
        remoteReconciliations: [{ kind: 'unfavorite', operationId: 'remote-1' }]
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    await screen.findByText('1个视频同步失败')
    const header = screen.getByRole('banner', { name: '小咪收藏库' })
    expect(header).toHaveTextContent('1个视频同步失败')
    expect(header).toHaveTextContent('另有1条')
    expect(screen.queryByText('远程操作待处理')).not.toBeInTheDocument()
    expect(screen.getByTestId('favorite-library-drawer').querySelectorAll('.favorite-library__layout > *')).toHaveLength(3)
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('选择一个视频查看详情')
    expect(screen.getByTestId('favorite-library-drawer').querySelector('.favorite-library__row-columns')).toHaveTextContent('视频名称')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: '不相关的搜索' } })
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 50, query: '不相关的搜索' }))
    fireEvent.click(screen.getByRole('button', { name: '状态筛选' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '未同步' }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 50, query: '不相关的搜索', filter: 'unsynced' }))
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'pending' }, { limit: 50 }))
  })
})
