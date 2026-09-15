import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDrawer } from './FavoriteLibraryDrawer'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FavoriteLibraryDrawer integration', () => {
  it('shows only the specific sync confirmation notice for an unknown remote result', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-09-07T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 1,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 1 }, remoteReconciliations: []
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(await screen.findByText('1个视频同步待确认')).toBeInTheDocument()
    expect(screen.queryByText('远程状态待确认：操作失败或结果未知')).not.toBeInTheDocument()
  })

  it('keeps its rendered view while reopening and performs one background validation', async () => {
    const getFavoriteRepositoryLibraryPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1,
      items: [{ video: { aid: 1, title: 'Cached reopen row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop
    const view = render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await screen.findByText('Cached reopen row')
    view.rerender(<FavoriteLibraryDrawer open={false} collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    view.rerender(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    expect(screen.getByText('Cached reopen row')).toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(getFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(2)
  })

  it('retains the cached folder search, sort, page, scroll, selection, and detail without refreshing on reopen', async () => {
    let resolveReopenPage: ((value: Record<string, unknown>) => void) | undefined
    let reopening = false
    const pageItems = (page: number) => Array.from({ length: 20 }, (_, index) => {
      const aid = (page - 1) * 20 + index + 1
      return {
        video: { aid, title: `Cached result ${aid}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' },
        folderIds: ['cached-folder'],
        pendingStates: []
      }
    })
    const getFavoriteRepositoryLibraryPage = vi.fn((_accountMid: string, scope: { kind: string }, options: { page?: number }) => {
      if (reopening) return new Promise((resolve) => { resolveReopenPage = resolve })
      const page = options.page ?? 1
      return Promise.resolve({
        version: 1 as const,
        accountMid: '100',
        revision: 1,
        page,
        pageCount: 2,
        totalCount: 40,
        items: scope.kind === 'folder' ? pageItems(page) : pageItems(1)
      })
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 40, folderCount: 1,
        folders: [{ id: 'cached-folder', title: 'Cached folder', kind: 'bilimi-logical', logicalLedgerId: 'cached-folder', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage,
      getFavoriteRepositoryLibraryVideoDetail: vi.fn((accountMid: string, aid: number) => Promise.resolve({
        version: 1 as const,
        accountMid,
        revision: 1,
        video: { aid, title: `Cached result ${aid}`, description: 'Cached detail', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' },
        folderIds: ['cached-folder'],
        pendingStates: [],
        mirror: { status: 'synced' },
        transcription: { status: '未转写' },
        archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      })),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    const view = render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await screen.findByText('Cached result 1')
    fireEvent.click(screen.getByRole('button', { name: 'Cached folder' }))
    await screen.findByText('Cached result 1')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: 'cached query' } })
    await waitFor(() => expect(getFavoriteRepositoryLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'cached-folder' }, {
      limit: 50, page: 1, query: 'cached query', sort: 'updated-desc'
    }))
    fireEvent.click(screen.getByRole('button', { name: '标题排序' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '标题 A-Z' }))
    await waitFor(() => expect(getFavoriteRepositoryLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'cached-folder' }, {
      limit: 50, page: 1, query: 'cached query', sort: 'title-asc'
    }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('Cached result 21')
    // The page rows are published before the paging callback commits its
    // post-navigation scroll reset.  Wait for that committed page state
    // before emulating a user scroll, otherwise a slow concurrent suite can
    // race the test's scroll with the legitimate page-change reset.
    await screen.findByText('第 2 页')
    const list = screen.getByRole('list', { name: '收藏库视频列表' })
    list.scrollTop = 120
    fireEvent.scroll(list)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Cached result 21' }))
    fireEvent.click(screen.getByText('Cached result 21'))
    expect(await screen.findByRole('complementary', { name: '视频详情' })).toHaveTextContent('Cached result 21')

    view.rerender(<FavoriteLibraryDrawer open={false} collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    const callsBeforeReopen = getFavoriteRepositoryLibraryPage.mock.calls.length
    reopening = true
    view.rerender(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(within(list).getByText('Cached result 21')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: '搜索收藏库' })).toHaveValue('cached query')
    expect(screen.getByText('视频名称（标题 A-Z）')).toBeInTheDocument()
    expect(screen.getByText('第 2 页')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 Cached result 21' })).toBeChecked()
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('Cached result 21')
    expect(list.scrollTop).toBe(120)
    expect(screen.queryByRole('status', { name: '正在刷新收藏库' })).not.toBeInTheDocument()
    expect(getFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(callsBeforeReopen)
    expect(resolveReopenPage).toBeUndefined()
  })

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

    expect(await screen.findByText('正在扫描已有收藏')).toBeInTheDocument()
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
    await screen.findByText('（UID：200）')
    expect(screen.queryByText('本次转写成功 1 项')).not.toBeInTheDocument()

    currentAccountMid = '100'
    act(() => { onAccountChanged?.() })
    await screen.findByText('（UID：100）')
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
    expect(screen.getByTestId('favorite-library-drawer').querySelectorAll('.favorite-library__layout > *')).toHaveLength(4)
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('选择一个视频查看详情')
    expect(screen.getByTestId('favorite-library-drawer').querySelector('.favorite-library__row-columns')).toHaveTextContent('视频名称')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: '不相关的搜索' } })
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 50, page: 1, query: '不相关的搜索', sort: 'updated-desc' }))
    fireEvent.click(screen.getByRole('button', { name: '状态筛选' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '同步' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '未同步' }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, {
      limit: 50,
      page: 1,
      query: '不相关的搜索',
      sort: 'updated-desc',
      stateFilters: { sync: 'unsynced' }
    }))
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'pending' }, { limit: 50, page: 1, sort: 'updated-desc' }))
  })
})
