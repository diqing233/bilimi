import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryApp } from './FavoriteLibraryApp'
import { FavoriteLibraryDialogs } from './FavoriteLibraryDialogs'
import { FavoriteLibraryToolbar } from './FavoriteLibraryToolbar'

const text = {
  library: '\u6536\u85cf\u5e93',
  all: '\u5168\u90e8\u6536\u85cf',
  pending: '\u5f85\u5904\u7406',
  videoList: '\u6536\u85cf\u5e93\u89c6\u9891\u5217\u8868',
  detail: '\u89c6\u9891\u8be6\u60c5',
  hideDetail: '\u6536\u8d77\u8be6\u60c5',
  localFolder: '\u672c\u5730\u6574\u7406',
  nextPage: '\u4e0b\u4e00\u9875'
} as const

const favoriteLibraryStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'),
  'utf8'
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'bilimiDesktop')
})

describe('FavoriteLibraryApp', () => {
  it('pauses repository and transcription work while inactive, then validates once when reopened', async () => {
    const unsubscribeRepository = vi.fn()
    const unsubscribeTranscription = vi.fn()
    const subscribeFavoriteRepository = vi.fn(() => unsubscribeRepository)
    const onFavoriteLibraryTranscriptionChanged = vi.fn(() => unsubscribeTranscription)
    const openFavoriteRepositoryAccount = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 0, folderCount: 0,
      folders: [], physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
    })
    const getFavoriteRepositoryLibraryPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1, totalCount: 0, items: []
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount,
      getFavoriteRepositoryLibraryPage,
      subscribeFavoriteRepository,
      onFavoriteLibraryTranscriptionChanged,
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ activeItemId: undefined, sessionCompletedCount: 0, items: [] })
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<FavoriteLibraryApp active={false} />)
    await act(async () => {})
    expect(openFavoriteRepositoryAccount).not.toHaveBeenCalled()
    expect(getFavoriteRepositoryLibraryPage).not.toHaveBeenCalled()
    expect(subscribeFavoriteRepository).not.toHaveBeenCalled()
    expect(onFavoriteLibraryTranscriptionChanged).not.toHaveBeenCalled()

    rerender(<FavoriteLibraryApp active />)
    expect(await screen.findByRole('heading', { name: '全部收藏 0 个视频' })).toBeInTheDocument()
    expect(openFavoriteRepositoryAccount).toHaveBeenCalledTimes(1)
    expect(getFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(1)
    expect(subscribeFavoriteRepository).toHaveBeenCalledTimes(1)
    expect(onFavoriteLibraryTranscriptionChanged).toHaveBeenCalledTimes(1)

    rerender(<FavoriteLibraryApp active={false} />)
    expect(unsubscribeRepository).toHaveBeenCalledTimes(1)
    expect(unsubscribeTranscription).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: '全部收藏 0 个视频' })).toBeInTheDocument()

    rerender(<FavoriteLibraryApp active />)
    await waitFor(() => expect(openFavoriteRepositoryAccount).toHaveBeenCalledTimes(2))
    expect(getFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(2)
  })

  it('treats rapid workspace collapse changes as navigation-only and persists their final state once', async () => {
    const getFavoriteRepositoryLibraryPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1, totalCount: 20,
      items: Array.from({ length: 20 }, (_, index) => ({
        video: { aid: index + 1, title: index === 0 ? '保留的工作夹视频' : `工作夹视频 ${index + 1}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' },
        folderIds: ['bilimi-logical:music'], pendingStates: []
      }))
    })
    const saveFavoriteLibraryUiPreferences = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      getFavoriteLibraryUiPreferences: vi.fn().mockResolvedValue({}),
      saveFavoriteLibraryUiPreferences,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('保留的工作夹视频')).toBeInTheDocument()
    vi.useFakeTimers()
    const list = screen.getByRole('list', { name: text.videoList })
    list.scrollTop = 44
    fireEvent.scroll(list)
    const collapse = screen.getByRole('button', { name: '收起bilimi 工作夹' })
    const initialPageRequests = getFavoriteRepositoryLibraryPage.mock.calls.length

    fireEvent.click(collapse)
    fireEvent.click(screen.getByRole('button', { name: '展开bilimi 工作夹' }))
    fireEvent.click(screen.getByRole('button', { name: '收起bilimi 工作夹' }))

    expect(getFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(initialPageRequests)
    expect(screen.getByText('保留的工作夹视频')).toBeInTheDocument()
    expect(list.scrollTop).toBe(44)
    expect(saveFavoriteLibraryUiPreferences).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(saveFavoriteLibraryUiPreferences).toHaveBeenCalledTimes(1)
    expect(saveFavoriteLibraryUiPreferences).toHaveBeenCalledWith('100', { workspace: true })
  })

  it('keeps a selected work-folder scope while its group is collapsed and restores each account preference independently', async () => {
    let currentAccount = '100'
    let notifyAccountChange: (() => void) | undefined
    const getFavoriteRepositoryLibraryPage = vi.fn(async (accountMid: string, scope: { kind: string; folderId?: string }) => ({
      version: 1 as const, accountMid, revision: 1, totalCount: 1,
      items: [{ video: { aid: Number(accountMid), title: scope.kind === 'folder' ? `工作夹 ${accountMid}` : `全部 ${accountMid}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [`bilimi-logical:${accountMid}`], pendingStates: [] }]
    }))
    const saveFavoriteLibraryUiPreferences = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn(() => Promise.resolve(currentAccount)),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      getFavoriteLibraryUiPreferences: vi.fn().mockResolvedValue({}),
      saveFavoriteLibraryUiPreferences,
      openFavoriteRepositoryAccount: vi.fn((accountMid: string) => Promise.resolve({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: `bilimi-logical:${accountMid}`, title: `工作夹 ${accountMid}`, kind: 'bilimi-logical', logicalLedgerId: accountMid, syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '工作夹 100' }))
    expect(await screen.findByRole('heading', { name: /工作夹 100/ })).toBeInTheDocument()
    const requestsBeforeCollapse = getFavoriteRepositoryLibraryPage.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '收起bilimi 工作夹' }))
    expect(getFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(requestsBeforeCollapse)

    currentAccount = '200'
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByText('全部 200')).toBeInTheDocument()
    currentAccount = '100'
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByRole('heading', { name: /工作夹 100/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开bilimi 工作夹' })).toBeInTheDocument()
    await waitFor(() => expect(saveFavoriteLibraryUiPreferences).toHaveBeenCalledWith('100', { workspace: true }))
    expect(saveFavoriteLibraryUiPreferences).not.toHaveBeenCalledWith('200', expect.anything())
  })

  it('keeps the virtual favorite list at the dense adaptive row height', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.tsx'), 'utf8')

    expect(source).not.toContain('itemHeight={72}')
    expect(favoriteLibraryStyles).toContain('.favorite-library__row { display: grid;')
    expect(favoriteLibraryStyles).toContain('padding: 4px 12px;')
    expect(favoriteLibraryStyles).toContain('min-height: 22px')
    expect(favoriteLibraryStyles).toContain('gap: 2px')
  })

  it('uses an edge-to-edge solid workspace divider, compact rows, and a single-line batch trigger', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__workspace-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; margin: 0 -12px 8px; padding: 0 12px 8px; border-bottom: 1px solid #c9dcf5; }')
    expect(favoriteLibraryStyles).toContain('.favorite-library__batch-actions > button, .favorite-library__batch-actions > .favorite-library__batch-split { flex: 0 0 auto; min-height: 30px; white-space: nowrap; }')
    expect(favoriteLibraryStyles).toContain('.favorite-library__row-wrap { display: flex; box-sizing: border-box; min-height: 64px;')
    expect(favoriteLibraryStyles).toContain('.favorite-library__row { display: grid; box-sizing: border-box; align-items: center;')
  })

  it('shows an explicit library loading state instead of a false zero while summary and page are pending', async () => {
    let resolveSummary: ((value: Record<string, unknown>) => void) | undefined
    let resolvePage: ((value: Record<string, unknown>) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn(() => new Promise((resolve) => { resolveSummary = resolve })),
      getFavoriteRepositoryLibraryPage: vi.fn(() => new Promise((resolve) => { resolvePage = resolve })),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByRole('status', { name: '正在读取收藏库' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /0 个视频/ })).not.toBeInTheDocument()
    expect(window.bilimiDesktop.getFavoriteRepositoryLibraryPage).toHaveBeenCalledWith('100', { kind: 'all' }, { limit: 50, page: 1 })

    await act(async () => {
      resolveSummary?.({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 0, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } })
      resolvePage?.({ version: 1, accountMid: '100', revision: 1, items: [] })
    })
    expect(await screen.findByRole('heading', { name: '全部收藏 0 个视频' })).toBeInTheDocument()
  })

  it('keeps the loading heading when a zero summary arrives before its page', async () => {
    let resolveSummary: ((value: Record<string, unknown>) => void) | undefined
    let resolvePage: ((value: Record<string, unknown>) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn(() => new Promise((resolve) => { resolveSummary = resolve })),
      getFavoriteRepositoryLibraryPage: vi.fn(() => new Promise((resolve) => { resolvePage = resolve })),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByRole('status', { name: '正在读取收藏库' })
    await act(async () => {
      resolveSummary?.({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 0, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } })
    })

    expect(screen.getByRole('status', { name: '正在读取收藏库' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /0 个视频/ })).not.toBeInTheDocument()
    await act(async () => { resolvePage?.({ version: 1, accountMid: '100', revision: 1, items: [] }) })
    expect(await screen.findByRole('heading', { name: '全部收藏 0 个视频' })).toBeInTheDocument()
  })

  it('keeps cached rows visible and announces a revision refresh while the replacement page is pending', async () => {
    let notify: (() => void) | undefined
    let resolveRefreshPage: ((value: Record<string, unknown>) => void) | undefined
    const getPage = vi.fn()
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: 'Cached row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefreshPage = resolve }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn((_accountMid, _folderId, callback) => { notify = () => callback({}); return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Cached row')).toBeInTheDocument()
    // A repository revision can be delivered as soon as the first page is painted.
    // The visible page must not precede installation of its change subscription.
    expect(window.bilimiDesktop.subscribeFavoriteRepository).toHaveBeenCalledWith('100', undefined, expect.any(Function))
    await act(async () => { notify?.() })

    expect(screen.getByText('Cached row')).toBeInTheDocument()
    expect(await screen.findByRole('status', { name: '正在刷新收藏库' })).toBeInTheDocument()
    await act(async () => { resolveRefreshPage?.({ version: 1, accountMid: '100', revision: 1, items: [] }) })
  })

  it('updates only the summary when a repository change leaves the current page valid', async () => {
    let notify: ((change: { revision: number; pageInvalidated: boolean }) => void) | undefined
    const getPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1, totalCount: 1,
      items: [{ video: { aid: 1, title: 'Stable row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    })
    const getSnapshot = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-27T00:00:01.000Z', videoCount: 2, folderCount: 0,
      folders: [], physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, scopeCounts: { all: 2, pending: 0, protected: 0, unsynced: 0 }
    })
    const openAccount = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
      folders: [], physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, scopeCounts: { all: 1, pending: 0, protected: 0, unsynced: 0 }
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: openAccount,
      getFavoriteRepositorySnapshot: getSnapshot,
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn((_accountMid, _folderId, callback) => { notify = callback as typeof notify; return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Stable row')).toBeInTheDocument()
    await act(async () => { notify?.({ revision: 2, pageInvalidated: false }) })

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1))
    expect(getPage).toHaveBeenCalledTimes(1)
    expect(openAccount).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Stable row')).toBeInTheDocument()
  })

  it('does not turn a zero summary into an empty state when its initial page fails', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 0, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockRejectedValue(new Error('offline')),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByRole('status', { name: '收藏库无法读取' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /0 个视频/ })).not.toBeInTheDocument()
  })

  it('requests a globally searched page instead of filtering only the visible page', async () => {
    const getPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 100, folderCount: 0,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByRole('searchbox', { name: '搜索收藏库' })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: 'later page' } })
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, {
      limit: 50, page: 1, query: 'later page'
    }))
  })

  it('shows the folder total separately from filtered results in the workspace heading', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 3, folderCount: 0,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, totalCount: 1,
        items: [{ video: { aid: 1, title: '命中视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByRole('heading', { name: '全部收藏 3 个视频' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: '命中' } })
    expect(await screen.findByText('总计 3 个 · 当前显示 1 个')).toBeInTheDocument()
  })

  it('syncs an entire logical folder and refreshes its local category without using the current result selection', async () => {
    const synchronizeFavoriteLibraryPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const getFavoriteRepositoryLibraryPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 3, folderCount: 1,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage,
      synchronizeFavoriteLibraryPlacements,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '同步当前收藏夹' }))
    await waitFor(() => expect(synchronizeFavoriteLibraryPlacements).toHaveBeenCalledWith('100', { kind: 'folder', folderId: 'bilimi-logical:music' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新当前分类' }))
    await waitFor(() => expect(getFavoriteRepositoryLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'bilimi-logical:music' }, expect.objectContaining({ page: 1 })))
  })

  it('only refreshes a Bilibili folder and shows neither current-folder action for all favorites', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 1,
        folders: [{ id: 'bilibili:2', title: 'B站收藏', kind: 'bilibili', remoteFolderId: '2', syncState: 'synced' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByRole('button', { name: '全部收藏' })
    expect(screen.queryByRole('button', { name: '同步当前收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新当前分类' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'B站收藏' }))
    expect(await screen.findByRole('button', { name: '刷新当前分类' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '同步当前收藏夹' })).not.toBeInTheDocument()
  })

  it('rolls back an optimistic folder highlight when its page request fails', async () => {
    const getPage = vi.fn()
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: 'confirmed row', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] })
      .mockRejectedValueOnce(new Error('offline'))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('confirmed row')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    expect(screen.getByRole('button', { name: '音乐' })).toHaveAttribute('aria-current', 'page')

    await waitFor(() => expect(screen.getByRole('button', { name: '全部收藏' })).toHaveAttribute('aria-current', 'page'))
    expect(screen.getByText('confirmed row')).toBeInTheDocument()
  })

  it('keeps the latest folder selected when an older folder request rejects last', async () => {
    let rejectMusic!: (reason?: unknown) => void
    const getPage = vi.fn()
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [] })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectMusic = reject }))
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 2, title: 'games row', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:games'], pendingStates: [] }] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 2,
        folders: [
          { id: 'bilimi-logical:music', title: 'music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' },
          { id: 'bilimi-logical:games', title: 'games', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }
        ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    await screen.findByRole('button', { name: 'music' })

    fireEvent.click(screen.getByRole('button', { name: 'music' }))
    fireEvent.click(screen.getByRole('button', { name: 'games' }))
    expect(await screen.findByText('games row')).toBeInTheDocument()
    rejectMusic(new Error('stale request'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'games' })).toHaveAttribute('aria-current', 'page'))
    expect(screen.getByRole('heading', { name: /games/ })).toBeInTheDocument()
  })

  it('does not rebuild 30000 destination options when one checkbox toggles', async () => {
    let idReads = 0
    const folders = Array.from({ length: 30_000 }, (_, index) => ({
      get id() { idReads += 1; return `logical:${index}` },
      title: `folder ${index}`, kind: 'bilimi-logical', logicalLedgerId: `${index}`, syncState: 'bound'
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: folders.length,
        folders, physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: 'row', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    await screen.findByText('row')
    const readsAfterRender = idReads

    fireEvent.click(screen.getByRole('checkbox', { name: /选择 row/ }))

    expect(idReads - readsAfterRender).toBeLessThan(10)
  })

  it('opens the centered new-ledger editor from the workspace creation action', async () => {
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'bilimi 工作夹管理菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新建工作夹' }))

    expect(openFloatingAssistantWorkspace).toHaveBeenCalledWith({ tab: 'ledger', sidebar: true, createLedger: true })
  })

  it('holds group remote deletion at a visible second confirmation after its safe preview', async () => {
    const executeFavoriteLibraryManagedFolderRemoteDelete = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 1,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 1, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      previewFavoriteLibraryManagedFolderGroupDelete: vi.fn().mockResolvedValue({ remoteAllowed: true, folders: [{ logicalFolderId: 'bilimi-logical:music', executionToken: 'preview-1', localMemberCount: 0, remoteAllowed: true }] }),
      previewFavoriteLibraryManagedFolderDelete: vi.fn().mockResolvedValue({ executionToken: 'current-1', remoteBinding: { remoteFolderId: '9' } }),
      confirmFavoriteLibraryManagedFolderRemoteDelete: vi.fn().mockResolvedValue({ confirmationToken: 'confirm-1' }),
      executeFavoriteLibraryManagedFolderRemoteDelete,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'bilimi 工作夹管理菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除全部工作夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除全部工作夹' })
    expect(dialog.closest('.bilimi-modal__viewport')).toBeInTheDocument()
    expect(Array.from(dialog.querySelectorAll('button')).slice(0, 3).map((button) => button.textContent)).toEqual(['取消', '仅从收藏库删除全部', '同步删除 B 站'])
    fireEvent.click(screen.getByRole('button', { name: '同步删除 B 站' }))

    expect(executeFavoriteLibraryManagedFolderRemoteDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认同步删除 B 站' }))
    await waitFor(() => expect(executeFavoriteLibraryManagedFolderRemoteDelete).toHaveBeenCalledWith('100', 'current-1', 'confirm-1'))
  })

  it('reports successful, skipped, and failed work-folder syncs after serial execution', async () => {
    const synchronizeFavoriteLibraryPlacements = vi.fn()
      .mockResolvedValueOnce({ status: 'succeeded' })
      .mockResolvedValueOnce({ status: 'succeeded', completedOperationCount: 0, totalOperationCount: 0 })
      .mockRejectedValueOnce(new Error('network'))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 3,
        folders: [
          { id: 'bilimi-logical:inbox', title: 'bilimi·暂存', kind: 'bilimi-logical', logicalLedgerId: 'inbox', syncState: 'bound' },
          { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' },
          { id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }
        ], physicalShardCount: 3, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      synchronizeFavoriteLibraryPlacements,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'bilimi 工作夹管理菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '同步全部工作夹' }))

    expect(await screen.findByRole('status')).toHaveTextContent('同步完成 1 个，跳过 1 个，失败 1 个')
    expect(synchronizeFavoriteLibraryPlacements).toHaveBeenNthCalledWith(1, '100', { kind: 'folder', folderId: 'bilimi-logical:inbox' })
    expect(synchronizeFavoriteLibraryPlacements).toHaveBeenNthCalledWith(3, '100', { kind: 'folder', folderId: 'bilimi-logical:games' })
  })

  it('keeps managed-folder deletion in an overlay so the three-column workspace remains intact', () => {
    render(<FavoriteLibraryDialogs managedFolder={{ title: '音乐', canDeleteRemotely: true }} />)

    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveClass('bilimi-modal__dialog', 'favorite-library__dialog-overlay')
    expect(favoriteLibraryStyles).not.toContain('.favorite-library__dialog-backdrop { position: fixed;')
    expect(favoriteLibraryStyles).toContain('.bilimi-modal__body .favorite-library__dialog-actions button:hover:not(:disabled)')
    expect(favoriteLibraryStyles).toContain('grid-template-columns: var(--favorite-columns);')
  })

  it('does not create an implicit workspace row just to draw a divider', () => {
    expect(favoriteLibraryStyles).not.toContain('.favorite-library__workspace::after')
    expect(favoriteLibraryStyles).toContain('.favorite-library__workspace { border: 0; }')
  })

  it('keeps detail danger actions separated by a line without a danger card treatment', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__detail-danger { padding: 12px !important;')
    expect(favoriteLibraryStyles).not.toContain('.favorite-library__detail-danger { padding: 10px !important;')
  })

  it('labels detail removal as other operations without a red danger divider', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.tsx'), 'utf8')

    expect(source).toContain('<section className="favorite-library__detail-danger"><h3>其他操作</h3>')
    expect(favoriteLibraryStyles).not.toContain('border-top: 1px solid #f0b6a8 !important')
  })

  it('right-aligns the complete center pagination group, including when it wraps', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__footer-pagination { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end;')
  })

  it('highlights each full row wrapper, including its selection checkbox', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__row-wrap:hover { background: #f0f6ff; }')
  })

  it('styles the reused avatar and batch destination menus without a danger-card border', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__brand-mark img { width: 24px; height: 24px;')
    expect(favoriteLibraryStyles).toContain('.favorite-library__batch-floating-menu { position: fixed;')
    expect(favoriteLibraryStyles).not.toContain('.favorite-library__batch-action-danger button, .favorite-library__danger-action { color: #9d2e2e; border-color: #efb3a4; }')
  })

  it('keeps only search, selection, and batch actions in the toolbar', () => {
    const onSearchChange = vi.fn()
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={0} allCurrentPageSelected={false} onTogglePage={() => undefined}
      searchQuery="" onSearchChange={onSearchChange} />)

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: '音乐' } })
    expect(onSearchChange).toHaveBeenCalledWith('音乐')
    expect(screen.queryByRole('combobox', { name: '筛选状态' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '排序方式' })).not.toBeInTheDocument()
    expect(screen.getByText('已选 0 项')).toBeInTheDocument()
  })
  it('keeps expanded batch actions on the common toolbar row', () => {
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected={true} onTogglePage={() => undefined} />)
    const batchTrigger = screen.getByRole('button', { name: '更多批量操作' })
    expect(batchTrigger.querySelector('.favorite-library__chevron')).toBeInTheDocument()
    fireEvent.click(batchTrigger)

    expect(screen.getByRole('button', { name: '同步到B站' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从收藏库删除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消B站收藏' })).toBeInTheDocument()
  })

  it('wraps toolbar controls at a narrow embedded width instead of collapsing labels into vertical columns', () => {
    expect(favoriteLibraryStyles).toMatch(/@container\s+\(max-width:\s*560px\)[\s\S]*?\.favorite-library__batch-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;/)
    expect(favoriteLibraryStyles).toMatch(/@container\s+\(max-width:\s*560px\)[\s\S]*?\.favorite-library__batch-actions\s*>\s*button,[\s\S]*?white-space:\s*nowrap;/)
  })

  it('keeps every list column reachable in the narrow embedded container', () => {
    expect(favoriteLibraryStyles).toMatch(/@container\s+\(max-width:\s*560px\)[\s\S]*?\.favorite-library__row-columns\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) minmax\(68px, \.7fr\) minmax\(84px, \.9fr\);/)
    expect(favoriteLibraryStyles).toMatch(/@container\s+\(max-width:\s*560px\)[\s\S]*?\.favorite-library__row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(68px, \.7fr\) minmax\(84px, \.9fr\);/)
    expect(favoriteLibraryStyles).toContain('.favorite-library__row-transcription button { width: min(84px, 100%);')
  })

  it('uses compact list columns before the embedded navigation leaves too little card width', () => {
    const embeddedNarrowStyles = favoriteLibraryStyles.split('@container (max-width: 560px)')[0]
    expect(embeddedNarrowStyles).toContain('.favorite-library__row-columns { grid-template-columns: 24px minmax(0, 1fr) minmax(68px, .7fr) minmax(84px, .9fr);')
    expect(embeddedNarrowStyles).toContain('.favorite-library__row { grid-template-columns: minmax(0, 1fr) minmax(68px, .7fr) minmax(84px, .9fr);')
  })

  it('keeps the embedded footer in the fourth library grid row below the three-column workspace', () => {
    expect(favoriteLibraryStyles).toContain(".favorite-library[data-embedded='true'] { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;")
    expect(favoriteLibraryStyles).toContain(".favorite-library__layout > .favorite-library__footer { grid-column: 2; grid-row: 2;")
  })
  it('shows source method and a readable source time in the selected video detail', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '来源视频', tags: [], favoriteAt: '2026-07-24T01:02:03.000Z', scannedAt: '2026-07-24T04:05:06.000Z', updatedAt: '2026-07-24T04:05:06.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: '来源视频', tags: [], favoriteAt: '2026-07-24T01:02:03.000Z', scannedAt: '2026-07-24T04:05:06.000Z', updatedAt: '2026-07-24T04:05:06.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('来源视频'))
    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('来源与时间')
    expect(detail).toHaveTextContent('B站收藏 · 2026-07-24 09:02')
    const audioSection = screen.getByRole('heading', { name: '音频与档案' }).closest('section')!
    const sourceSection = screen.getByRole('heading', { name: '来源与时间' }).closest('section')!
    expect(audioSection.compareDocumentPosition(sourceSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(sourceSection).getByRole('button', { name: '查看完整处理记录' })).toBeInTheDocument()
  })

  it('shows an unavailable status without hiding the saved video facts', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 9, title: '保留的旧标题', tags: ['旧标签'], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        video: { aid: 9, title: '保留的旧标题', tags: ['旧标签'], updatedAt: '2026-07-24T00:00:00.000Z' },
        folderIds: [], pendingStates: [], protected: true,
        mirror: { status: '同步失败', errorCode: 'unavailable', remoteCode: 62012, lastCheckedAt: '2026-07-24T02:03:04.000Z' },
        transcription: { status: '未转写' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: true, hasSummary: false }
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('保留的旧标题'))
    const detail = await screen.findByRole('complementary')
    expect(within(detail).getByText('已失效')).toHaveAttribute('data-tone', 'danger')
    expect(detail).toHaveTextContent('返回码 62012')
    expect(detail).toHaveTextContent('2026-07-24 10:03')
    expect(detail).toHaveTextContent('保留的旧标题')
    fireEvent.click(within(detail).getByRole('button', { name: '同步状态说明' }))
    expect(detail).toHaveTextContent('同步状态以当前的 B 站归属对账结果为准')
    expect(detail).not.toHaveTextContent('B 站已明确返回该视频不可见')
    fireEvent.click(within(detail).getByRole('button', { name: '更多信息' }))
    expect(detail).toHaveTextContent('旧标签')
    expect(detail).toHaveTextContent('已入档')
  })
  it('limits a B站 source-folder detail to copying into local placements', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilibili:default', title: '默认收藏', kind: 'bilibili', remoteFolderId: '1', syncState: 'synced' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: 'B站来源视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilibili:default'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: 'B站来源视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilibili:default'], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '默认收藏' }))
    fireEvent.click(await screen.findByText('B站来源视频'))
    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('复制至')
    expect(detail).not.toHaveTextContent('移动到其他收藏夹')
    expect(detail).not.toHaveTextContent('同步B站位置')
    expect(within(detail).getByRole('button', { name: '视频总结' })).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: '其他操作' })).not.toBeInTheDocument()
    expect(detail).not.toHaveTextContent('从收藏库删除')
    expect(detail).not.toHaveTextContent('取消B站收藏')
  })
  it('hides adopting a Bilibili position until a completed remote observation exists', async () => {
    const adoptFavoriteLibraryRemotePlacement = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '未扫描视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: '未扫描视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [], position: { state: 'local-only-change', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-24T00:00:00.000Z' }, mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      adoptFavoriteLibraryRemotePlacement,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('未扫描视频'))
    const detail = await screen.findByRole('complementary')
    expect(within(detail).queryByRole('button', { name: '采用B站归属' })).not.toBeInTheDocument()
    expect(adoptFavoriteLibraryRemotePlacement).not.toHaveBeenCalled()
  })
  it('keeps a mixed all-favorites page selectable for full-result batch operations', async () => {
    const copyFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 2, folderCount: 2, folders: [{ id: 'bilibili:2', title: 'B站来源', kind: 'bilibili', remoteFolderId: '2', syncState: 'synced' }, { id: 'bilimi-logical:target', title: '目标工作夹', kind: 'bilimi-logical', logicalLedgerId: 'target', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [
        { video: { aid: 1, title: '本地视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
        { video: { aid: 2, title: 'B站视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilibili:2'], pendingStates: [] }
      ] }),
      copyFavoriteLibrarySelection,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByText('本地视频')
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '视频总结' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 B站视频' }))
    const copy = screen.getByRole('button', { name: '复制至' })
    expect(copy).toBeEnabled()
    expect(screen.queryByRole('button', { name: '移动至' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新信息' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '视频总结' })).toBeEnabled()
    fireEvent.click(copy)
    expect(screen.getByRole('menu', { name: '复制至收藏夹' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '目标工作夹' }))
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }))
    await waitFor(() => expect(copyFavoriteLibrarySelection).toHaveBeenCalledWith('100', [2], ['bilimi-logical:target'], 1, expect.any(Object)))
  })

  it('opens the existing organization guide with only explicitly selected aids', async () => {
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 3, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [
          { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
          { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
          { video: { aid: 3, title: '视频三', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
        ]
      }),
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频三' }))
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }))

    expect(openFloatingAssistantWorkspace).toHaveBeenCalledWith({
      tab: 'ledger', sidebar: true, organizeOldFavorites: true, selectedFavoriteAids: [1, 3]
    })
  })
  it('keeps reorganization available for a full-result selection without expanding every AID in the renderer', async () => {
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 30_000, folderCount: 1,
        folders: [{ id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }],
        physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:games'], pendingStates: [] }]
      }),
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '游戏' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }))

    expect(openFloatingAssistantWorkspace).toHaveBeenCalledWith({
      tab: 'ledger', sidebar: true, organizeOldFavorites: true,
      selectedFavoriteSelection: {
        kind: 'scope', scope: { kind: 'folder', folderId: 'bilimi-logical:games' },
        options: { query: '', filter: 'all', sort: 'updated-desc', transcriptionFilters: [] }, excludedAids: []
      }
    })
  })
  it('does not classify an ordinary Bilibili folder as a workspace from its bilimi title alone', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 1, folders: [
        { id: 'bilibili:99', title: 'bilimi 原神', kind: 'bilibili', remoteFolderId: '99', syncState: 'synced' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect((await screen.findByRole('button', { name: 'bilimi 原神' })).closest('[data-group-id]')).toHaveAttribute('data-group-id', 'bilibili')
  })
  it('shows managed-folder remote-delete preview diagnostics before its second dangerous confirmation', () => {
    render(<FavoriteLibraryDialogs managedFolder={{
      title: '音乐',
      canDeleteRemotely: true,
      preview: {
        currentRevision: 7,
        localMemberCount: 12,
        unmatchedFallbackCount: 3,
        extraRemoteMemberCount: 2,
        remoteOnlyMemberCount: 4
      }
    }} />)

    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('版本 7')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('受影响本地视频 12')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('未匹配回退 3')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('额外远端成员 2')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('仅远端成员 4')
  })
  it('keeps the compact detail placement picker without rendering normal descriptions', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__placement-picker')
    expect(favoriteLibraryStyles).toContain('.favorite-library__placement-preview')
    expect(favoriteLibraryStyles).toContain('.favorite-library__delete-confirmation')
  })
  it('keeps archive export, import preview, and server-scanned safe restore in a compact library entry', async () => {
    const exportFavoriteRepositoryArchive = vi.fn().mockResolvedValue({ accountMid: '100', schemaVersion: 1 })
    const previewFavoriteRepositoryArchiveImport = vi.fn().mockResolvedValue({
      accountMatches: true, canApply: true, canRestoreRemotely: true, videoCount: 1, eventCount: 0
    })
    const createFavoriteRepositoryArchiveRestorePlan = vi.fn().mockResolvedValue({
      mode: 'safe', accountMid: '100', operations: [{ aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: [], desiredLogicalFolderIds: ['bilimi-logical:music'] }], executionToken: 'scan-token', confirmationRequired: false
    })
    const executeFavoriteRepositoryArchiveRestore = vi.fn().mockResolvedValue({ id: 'restore-1', accountMid: '100', status: 'result-unknown', completedOperationCount: 0, totalOperationCount: 1, items: [{ aid: 1, status: 'result-unknown' }] })
    const reconcileFavoriteRepositoryArchiveRestore = vi.fn().mockResolvedValue({ id: 'restore-1', accountMid: '100', status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, items: [{ aid: 1, status: 'succeeded' }] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      exportFavoriteRepositoryArchive,
      previewFavoriteRepositoryArchiveImport,
      createFavoriteRepositoryArchiveRestorePlan,
      executeFavoriteRepositoryArchiveRestore,
      reconcileFavoriteRepositoryArchiveRestore,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '收藏存档' }))
    fireEvent.click(screen.getByRole('button', { name: '导出收藏存档' }))
    await waitFor(() => expect(exportFavoriteRepositoryArchive).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '检查存档' }))
    await waitFor(() => expect(previewFavoriteRepositoryArchiveImport).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '预览安全恢复到B站' }))
    await waitFor(() => expect(createFavoriteRepositoryArchiveRestorePlan).toHaveBeenCalledWith('100', expect.any(String), 'safe', { kind: 'all' }))
    expect(screen.getByText('将补齐 1 个 B 站受管归属，不会移除远端额外归属。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '执行安全恢复到B站' }))
    await waitFor(() => expect(executeFavoriteRepositoryArchiveRestore).toHaveBeenCalledWith('100', expect.objectContaining({ accountMid: '100' }), 'scan-token', undefined))
    expect(screen.getByText('远程结果待确认：请先对账，不能直接重试。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '执行安全恢复到B站' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对账恢复结果' }))
    await waitFor(() => expect(reconcileFavoriteRepositoryArchiveRestore).toHaveBeenCalledWith('100', expect.objectContaining({ accountMid: '100' }), 'scan-token'))
  })
  it('scopes archive recovery to selected aids or the current logical folder and displays each aid result', async () => {
    const createFavoriteRepositoryArchiveRestorePlan = vi.fn().mockResolvedValue({
      mode: 'safe', accountMid: '100', operations: [{ aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: [], desiredLogicalFolderIds: ['bilimi-logical:music'] }], executionToken: 'scope-token', confirmationRequired: false
    })
    const executeFavoriteRepositoryArchiveRestore = vi.fn().mockResolvedValue({
      id: 'restore-scopes', accountMid: '100', status: 'failed', completedOperationCount: 1, totalOperationCount: 2,
      items: [{ aid: 1, status: 'succeeded' }, { aid: 2, status: 'failed', reason: 'managed target is unbound' }]
    })
    const getFavoriteRepositoryLibraryPage = vi.fn().mockImplementation(async (_account, scope) => ({
      version: 1, accountMid: '100', revision: 1,
      items: scope.kind === 'folder' ? [
        { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] },
        { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }
      ] : [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 2, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 1, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage,
      previewFavoriteRepositoryArchiveImport: vi.fn().mockResolvedValue({ accountMatches: true, canApply: true, canRestoreRemotely: true, videoCount: 2, eventCount: 0 }),
      createFavoriteRepositoryArchiveRestorePlan,
      executeFavoriteRepositoryArchiveRestore,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    await screen.findByRole('checkbox', { name: '选择 视频一' })
    fireEvent.click(screen.getByRole('button', { name: '收藏存档' }))
    fireEvent.change(screen.getByRole('textbox', { name: '存档 JSON' }), { target: { value: '{"archive":true}' } })
    fireEvent.click(screen.getByRole('button', { name: '检查存档' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '恢复范围' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.change(screen.getByRole('combobox', { name: '恢复范围' }), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('button', { name: '预览安全恢复到B站' }))
    await waitFor(() => expect(createFavoriteRepositoryArchiveRestorePlan).toHaveBeenLastCalledWith('100', expect.any(String), 'safe', { kind: 'aids', aids: [1] }))

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    await waitFor(() => expect(screen.getByText('视频二')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox', { name: '恢复范围' }), { target: { value: 'current-folder' } })
    fireEvent.click(screen.getByRole('button', { name: '预览安全恢复到B站' }))
    await waitFor(() => expect(createFavoriteRepositoryArchiveRestorePlan).toHaveBeenLastCalledWith('100', expect.any(String), 'safe', { kind: 'logical-folder', folderId: 'bilimi-logical:music' }))
    fireEvent.click(screen.getByRole('button', { name: '执行安全恢复到B站' }))
    await waitFor(() => expect(screen.getByText('视频 #1：已完成')).toBeInTheDocument())
    expect(screen.getByText('视频 #2：失败（managed target is unbound）')).toBeInTheDocument()
  })
  it('copies selected videos to multiple workspace destinations from the toolbar menu', async () => {
    const copyFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 2, folders: [{ id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }, { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 2, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, items: [
        { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] },
        { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:games'], pendingStates: [] }
      ] }),
      copyFavoriteLibrarySelection,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频二' }))
    fireEvent.click(screen.getByRole('button', { name: '复制至' }))

    expect(screen.getByRole('menu', { name: '复制至收藏夹' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }))

    await waitFor(() => expect(copyFavoriteLibrarySelection).toHaveBeenCalledWith(
      '100', [1, 2], ['bilimi-logical:games', 'bilimi-logical:music'], 3, expect.any(Object)
    ))
    expect(screen.queryByText(/将复制 2 个所选视频/)).not.toBeInTheDocument()
    expect(document.querySelector('[data-testid="favorite-library-toolbar"] .favorite-library__placement-picker')).toBeNull()
  })
  it('uses the same destination confirmation menu for a detail copy', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const copyFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 2, folders: [{ id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }, { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 2, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'aligned', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      setFavoriteLibraryLocalPlacements, copyFavoriteLibrarySelection, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: /视频一 未知 UP 主/ }))
    fireEvent.click(await within(screen.getByRole('heading', { name: '收藏归属' }).closest('section')!).findByRole('button', { name: '复制至' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    expect(screen.getByRole('menu', { name: '复制至收藏夹' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }))
    await waitFor(() => expect(copyFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], ['bilimi-logical:games'], 3, expect.any(Object)))
    await waitFor(() => expect(setFavoriteLibraryLocalPlacements).not.toHaveBeenCalled())
  })
  it('keeps detail status dimensions explanatory and reveals descriptions only from more information', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const description = '这是一段很长的简介。'.repeat(40)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, items: [{ video: { aid: 1, title: 'Video + ID', description, tags: ['测试标签'], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: ['protected'] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, video: { aid: 1, title: 'Video + ID', description, tags: ['测试标签'], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: ['protected'], protected: true, position: { state: 'failed', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'failed' }, transcription: { status: '转写失败' }, archive: { status: '登记异常', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      syncFavoriteLibrarySelection, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Video + ID'))
    expect(screen.queryByText(/标签: 测试标签/)).not.toBeInTheDocument()
    expect(screen.queryByText(description)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更多信息' }))
    expect(await screen.findByText(/标签：测试标签/)).toBeInTheDocument()
    expect(screen.getByText(`简介：${description}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保护状态说明' }))
    expect(screen.getByRole('status')).toHaveTextContent('保护')
    const detail = screen.getByRole('complementary', { name: text.detail })
    const refreshMetadataButton = within(detail).getByRole('button', { name: '刷新信息' })
    expect(refreshMetadataButton.closest('.favorite-library__detail-heading-actions')).not.toBeNull()
    fireEvent.click(refreshMetadataButton)
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
    expect(screen.getByRole('button', { name: '整理状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保护状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同步状态说明' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '资料状态说明' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '位置状态说明' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '转写状态说明' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '档案状态说明' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消B站收藏' })).not.toBeInTheDocument()
    expect(screen.queryByText('仅取消当前视频在 B 站的全部收藏；不会删除收藏库本地记录、转写或档案。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '其他操作' }))
    expect(screen.getByRole('button', { name: '取消B站收藏' })).toBeDisabled()
    expect(screen.getByText('仅取消当前视频在 B 站的全部收藏；不会删除收藏库本地记录、转写或档案。')).toBeInTheDocument()
  })
  it('requires a local-only confirmation before deleting a library record', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const deleteFavoriteLibraryVideo = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '转写完成' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: false, hasSummary: true } }),
      setFavoriteLibraryLocalPlacements, deleteFavoriteLibraryVideo, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: /视频一 未知 UP 主/ }))
    fireEvent.click(await screen.findByRole('button', { name: '其他操作' }))
    expect(screen.getByRole('button', { name: '从所有 bilimi 工作夹移除' })).toHaveClass('favorite-library__danger-action')
    fireEvent.click(await screen.findByRole('button', { name: '从所有 bilimi 工作夹移除' }))
    expect(screen.getByText('将从所有 bilimi 工作夹移除；转写、档案、保护和处理记录会保留。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认仅从收藏库删除' }))
    await waitFor(() => expect(setFavoriteLibraryLocalPlacements).toHaveBeenCalledWith('100', [{ aid: 1, folderIds: [] }], 4, false))
    expect(deleteFavoriteLibraryVideo).not.toHaveBeenCalled()
  })
  it('removes only the current Bilimi membership while retaining the other work folders', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const deleteFavoriteLibraryVideo = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 2, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }, { id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [{ video: { aid: 1, title: '归属视频', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, video: { aid: 1, title: '归属视频', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'local-only-change', localDesiredFolderIds: ['bilimi-logical:music', 'bilimi-logical:games'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'synced' }, transcription: { status: '转写完成' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: false, hasSummary: true } }),
      setFavoriteLibraryLocalPlacements, deleteFavoriteLibraryVideo, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('button', { name: /归属视频 未知 UP 主/ }))
    fireEvent.click(await screen.findByRole('button', { name: '其他操作' }))
    fireEvent.click(screen.getByRole('button', { name: '从当前工作夹移除' }))

    expect(screen.getByText('只会从当前工作夹“音乐”移除；转写、档案、保护和处理记录会保留。')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog', { name: '确认从收藏库删除' }).closest('.bilimi-modal__viewport')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '同时从其他 bilimi 工作夹移除' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: '同时从其他 bilimi 工作夹移除' }))
    expect(screen.getByText('还会从 1 个工作夹移除：游戏')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认仅从收藏库删除' }))

    await waitFor(() => expect(setFavoriteLibraryLocalPlacements).toHaveBeenCalledWith('100', [{ aid: 1, folderIds: [] }], 4, false))
    expect(deleteFavoriteLibraryVideo).not.toHaveBeenCalled()
  })
  it('requires a separate second confirmation before cancelling the selected video on Bilibili', async () => {
    const previewFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({
      accountMid: '100', aids: [1], executionToken: 'preview-token', baselineRevision: 4
    })
    const confirmFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ confirmationToken: 'confirm-token' })
    const executeFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({
      status: 'succeeded', operationId: 'operation-1', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1]
    })
    const deleteFavoriteLibraryVideo = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      previewFavoriteLibraryRemoteUnfavoriteOperation, confirmFavoriteLibraryRemoteUnfavoriteOperation, executeFavoriteLibraryRemoteUnfavoriteOperation,
      deleteFavoriteLibraryVideo, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: /视频一 未知 UP 主/ }))
    fireEvent.click(await screen.findByRole('button', { name: '其他操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消B站收藏' }))
    await waitFor(() => expect(previewFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', [1], 4, expect.any(Object)))
    const remoteDialog = screen.getByRole('alertdialog', { name: '确认取消B站收藏' })
    expect(remoteDialog).toHaveTextContent('视频一')
    expect(remoteDialog.closest('.bilimi-modal__viewport')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认取消 B 站收藏' }))
    await waitFor(() => expect(confirmFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'preview-token'))
    expect(executeFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'preview-token', 'confirm-token')
    expect(deleteFavoriteLibraryVideo).not.toHaveBeenCalled()
  })
  it('holds batch remote-unfavorite at a visible preview until the dangerous confirmation is clicked', async () => {
    const previewFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({
      executionToken: 'batch-preview', baselineRevision: 4, aids: [1, 2], removesAllBilibiliMembership: true
    })
    const confirmFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ confirmationToken: 'batch-confirm' })
    const executeFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ status: 'result-unknown', operationId: 'batch-operation' })
    const reconcileFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ status: 'reconciliation-required' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [
        { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
        { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
      ] }),
      previewFavoriteLibraryRemoteUnfavoriteOperation,
      confirmFavoriteLibraryRemoteUnfavoriteOperation,
      executeFavoriteLibraryRemoteUnfavoriteOperation,
      reconcileFavoriteLibraryRemoteUnfavoriteOperation,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频二' }))
    fireEvent.click(screen.getByRole('button', { name: '更多批量操作' }))
    fireEvent.click(screen.getByRole('button', { name: '取消B站收藏' }))
    await waitFor(() => expect(previewFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', [1, 2], 4, expect.any(Object)))
    expect(executeFavoriteLibraryRemoteUnfavoriteOperation).not.toHaveBeenCalled()
    const batchDialog = screen.getByRole('alertdialog', { name: '确认批量取消B站收藏' })
    expect(batchDialog).toHaveTextContent('2 个视频')
    expect(batchDialog.closest('.bilimi-modal__viewport')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认取消所选 B 站收藏' }))
    await waitFor(() => expect(confirmFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'batch-preview'))
    expect(executeFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'batch-preview', 'batch-confirm')
    expect(await screen.findByRole('status')).toHaveTextContent('远程结果待确认')
    fireEvent.click(screen.getByRole('button', { name: '对账取消收藏结果' }))
    await waitFor(() => expect(reconcileFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'batch-operation'))
  })
  it('keeps every recovered remote reconciliation actionable and refreshes their status after a reconciliation', async () => {
    const reconcileFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const reconcileFavoriteLibraryManagedFolderDelete = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const openFavoriteRepositoryAccount = vi.fn()
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 2, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 2 }, remoteReconciliations: [{ kind: 'unfavorite', operationId: 'recovered-unfavorite' }, { kind: 'managed-folder', operationId: 'recovered-folder' }] })
      .mockResolvedValue({ version: 1, accountMid: '100', revision: 5, updatedAt: '2026-07-23T00:01:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, remoteReconciliations: [] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount,
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      reconcileFavoriteLibraryRemoteUnfavoriteOperation,
      reconcileFavoriteLibraryManagedFolderDelete,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByRole('button', { name: '对账取消收藏结果' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '对账文件夹删除结果' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对账取消收藏结果' }))
    await waitFor(() => expect(reconcileFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'recovered-unfavorite'))
    await waitFor(() => expect(openFavoriteRepositoryAccount).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: '对账取消收藏结果' })).not.toBeInTheDocument()
    expect(reconcileFavoriteLibraryManagedFolderDelete).not.toHaveBeenCalled()
  })
  it('confirms one atomic batch local deletion before clearing the selected rows', async () => {
    const deleteFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const deleteFavoriteLibraryVideo = vi.fn()
    const getFavoriteRepositoryLibraryPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 5, items: [
      { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
      { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
    ] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 5, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage,
      deleteFavoriteLibrarySelection,
      deleteFavoriteLibraryVideo,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频二' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '更多批量操作' }))
    fireEvent.click(screen.getByRole('button', { name: '从收藏库删除' }))

    expect(screen.getByRole('alertdialog', { name: '确认从收藏库批量删除' })).toHaveTextContent('2 个所选视频')
    expect(deleteFavoriteLibrarySelection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认仅从收藏库删除所选视频' }))

    await waitFor(() => expect(deleteFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1, 2], 5, expect.any(Object)))
    expect(deleteFavoriteLibrarySelection).toHaveBeenCalledTimes(1)
    expect(deleteFavoriteLibraryVideo).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('已选 0 项')).toBeInTheDocument())
    expect(getFavoriteRepositoryLibraryPage.mock.calls.length).toBeGreaterThan(1)
  })
  it('uses the toolbar copy and current-work-folder-only move contracts for batch placement', async () => {
    const copyFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const moveFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 2, folders: [
        { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' },
        { id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      copyFavoriteLibrarySelection,
      moveFavoriteLibrarySelection,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '复制至' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }))
    await waitFor(() => expect(copyFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], ['bilimi-logical:games'], 6, expect.any(Object)))

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '选择 视频一' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '移动至' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '确认移动' }))
    await waitFor(() => expect(moveFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], 'bilimi-logical:music', ['bilimi-logical:games'], 6, expect.any(Object)))
  })
  it('opens the exact managed ledger editor by stable ID instead of its display name', async () => {
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 2, folders: [
        { id: 'bilimi-logical:music-a', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music-a', syncState: 'bound' },
        { id: 'bilimi-logical:music-b', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music-b', syncState: 'bound' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [] }),
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click((await screen.findAllByRole('button', { name: '音乐 菜单' }))[0])
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑信息' }))

    expect(openFloatingAssistantWorkspace).toHaveBeenCalledWith({ tab: 'ledger', ledgerId: 'music-a', sidebar: true })
  })
  it('does not navigate to a title-matched editor when a managed folder has no stable ledger ID', async () => {
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 1, folders: [
        { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', syncState: 'bound' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [] }),
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐 菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑信息' }))

    expect(openFloatingAssistantWorkspace).not.toHaveBeenCalled()
  })
  it('does not offer remote managed-folder deletion without an unambiguous remote binding', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 1, folders: [
        { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [] }),
      previewFavoriteLibraryManagedFolderDelete: vi.fn().mockResolvedValue({ executionToken: 'delete-token', currentRevision: 6, localMemberCount: 0, unmatchedFallbackCount: 0, extraRemoteMemberCount: 0, remoteOnlyMemberCount: 0 }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐 菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))

    await screen.findByRole('dialog', { name: '删除 音乐' })
    expect(screen.queryByRole('button', { name: '删除并同步到B站' })).not.toBeInTheDocument()
  })
  it('runs singleton copy, B站 sync, and inline transcription actions with the selected aid', async () => {
    const copyFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const moveFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const synchronizeFavoriteLibraryPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const enqueueFavoriteLibraryTranscription = vi.fn().mockResolvedValue({ status: 'queued' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 2, folders: [
        { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' },
        { id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'synced', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-24T00:00:00.000Z' }, mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      copyFavoriteLibrarySelection,
      moveFavoriteLibrarySelection,
      synchronizeFavoriteLibraryPlacements,
      enqueueFavoriteLibraryTranscription,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: /视频一 未知 UP 主/ }))
    const ownership = screen.getByRole('heading', { name: '收藏归属' }).closest('section')!
    const copy = await within(ownership).findByRole('button', { name: '复制至' })
    expect(copy).toHaveClass('favorite-library__batch-destination-trigger')
    expect(copy).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(copy)
    expect(copy).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: '复制至收藏夹' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }))
    await waitFor(() => expect(copyFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], ['bilimi-logical:games'], 6, expect.any(Object)))

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('button', { name: /视频一 未知 UP 主/ }))
    const managedOwnership = screen.getByRole('heading', { name: '收藏归属' }).closest('section')!
    fireEvent.click(await within(managedOwnership).findByRole('button', { name: '移动至' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '确认移动' }))
    await waitFor(() => expect(moveFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], 'bilimi-logical:music', ['bilimi-logical:games'], 6, expect.any(Object)))

    fireEvent.click(screen.getByRole('button', { name: '同步到B站' }))
    await waitFor(() => expect(synchronizeFavoriteLibraryPlacements).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(enqueueFavoriteLibraryTranscription).toHaveBeenCalledWith('100', { aids: [1] }))
  })
  it('does not offer singleton move outside a bilimi logical folder scope', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'synced', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-24T00:00:00.000Z' }, mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    const detail = await screen.findByRole('complementary', { name: '视频详情' })
    expect(within(detail).getByRole('heading', { name: '收藏归属' }).closest('section')!).not.toContainElement(screen.queryByRole('button', { name: '移动至' }))
  })

  it('moves an unmatched video into a managed folder through the unmatched source contract', async () => {
    const moveFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 2,
        folders: [
          { id: 'local:inbox', title: '未匹配分类', kind: 'local', syncState: 'local-only' },
          { id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }
        ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 6,
        items: [{ video: { aid: 1, title: '未匹配视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['local:inbox'], pendingStates: [] }]
      }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 6,
        video: { aid: 1, title: '未匹配视频', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['local:inbox'], pendingStates: [],
        position: { state: 'local-only-change', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-24T00:00:00.000Z' },
        mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      }),
      moveFavoriteLibrarySelection,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '未匹配分类' }))
    fireEvent.click(await screen.findByRole('button', { name: /未匹配视频 未知 UP 主/ }))
    const ownership = screen.getByRole('heading', { name: '收藏归属' }).closest('section')!
    fireEvent.click(await within(ownership).findByRole('button', { name: '移动至' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '确认移动' }))

    await waitFor(() => expect(moveFavoriteLibrarySelection).toHaveBeenCalledWith(
      '100', [1], 'local:inbox', ['bilimi-logical:games'], 6, { kind: 'folder', folderId: 'local:inbox' }
    ))
  })

  it('keeps folder binding conflicts compact until the user opens the handling dialog', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 2, folders: [],
        folderConflicts: [{ title: 'bilimi·音乐', folderIds: ['bilibili:1', 'bilibili:2'], reason: '同名收藏夹无法证明属于同一个逻辑工作夹。', candidates: [{ id: 'bilibili:1', title: 'bilimi·音乐' }, { id: 'bilibili:2', title: 'bilimi·音乐' }] }],
        physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    const compact = await screen.findByRole('button', { name: '发现 1 项收藏夹问题，点击处理' })
    expect(screen.queryByRole('alertdialog', { name: '收藏夹问题处理' })).not.toBeInTheDocument()
    expect(screen.queryByText('同名收藏夹无法证明属于同一个逻辑工作夹。')).not.toBeInTheDocument()

    fireEvent.click(compact)
    const conflict = await screen.findByRole('alertdialog', { name: '收藏夹问题处理' })
    expect(conflict).toHaveTextContent('同名收藏夹无法证明属于同一个逻辑工作夹。')
    expect(conflict).toHaveTextContent('bilibili:1')
    expect(conflict).toHaveTextContent('bilibili:2')
    expect(conflict).toHaveTextContent('不会自行移动、改名或删除 B 站收藏夹')
    expect(within(conflict).getByRole('button', { name: '重新扫描' })).toBeInTheDocument()
  })
  it('resolves a registered archive by stable video identity before opening the archive host', async () => {
    const resolveFavoriteLibraryArchive = vi.fn().mockResolvedValue({ archiveId: 'private-id', versionId: 'private-version' })
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, items: [{ video: { aid: 1, cid: 70, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, video: { aid: 1, cid: 70, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '转写完成' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: false, hasSummary: true } }),
      resolveFavoriteLibraryArchive,
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '档案详情' }))
    await waitFor(() => expect(resolveFavoriteLibraryArchive).toHaveBeenCalledWith('100', 1, 70))
    expect(openFloatingAssistantWorkspace).toHaveBeenCalledWith({ tab: 'notes', openNoteArchive: true })
  })
  it('offers remote adoption only inside an explicit placement conflict choice', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const adoptFavoriteLibraryRemotePlacement = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 7, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 1, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 7, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 7, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'local-only-change', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      setFavoriteLibraryLocalPlacements,
      adoptFavoriteLibraryRemotePlacement,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    expect(adoptFavoriteLibraryRemotePlacement).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '采用B站归属' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '处理归属冲突' }))
    expect(screen.getByRole('button', { name: '以收藏库为准并同步' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '采用B站归属' }))
    await waitFor(() => expect(adoptFavoriteLibraryRemotePlacement).toHaveBeenCalledWith('100', 1, 7))
  })
  it('loads the user timeline only after it is explicitly requested', async () => {
    const getFavoriteRepositoryVideoEvents = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [
      { id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }
    ] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      getFavoriteRepositoryVideoEvents,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    expect(getFavoriteRepositoryVideoEvents).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '查看完整处理记录' }))
    await waitFor(() => expect(getFavoriteRepositoryVideoEvents).toHaveBeenCalledWith('100', 1, { limit: 20 }))
    expect(screen.getAllByText(/manual-move/)).not.toHaveLength(0)
  })

  it('renders Chinese labels and optional details for every repository event kind', async () => {
    const kinds = ['entered', 'daily-review', 'old-favorite-organization', 'manual-move', 'scan-observed', 'remote-sync', 'adopt-local', 'adopt-remote', 'transcription', 'archive-registration'] as const
    const labels = ['加入收藏库', '每日复查', '旧收藏整理', '手动移动', '扫描发现', '同步到 B 站', '采用收藏库归属', '采用 B 站归属', '转写处理', '档案登记']
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: 'Timeline labels', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: 'Timeline labels', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      getFavoriteRepositoryVideoEvents: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: kinds.map((kind, index) => ({ id: `event-${kind}`, sequence: index, accountMid: '100', aid: 1, kind, occurredAt: '2026-07-23T00:00:00.000Z', detail: `detail-${kind}` })) }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Timeline labels'))
    fireEvent.click(await screen.findByRole('button', { name: '查看完整处理记录' }))
    await screen.findByLabelText('完整处理记录')
    labels.forEach((label, index) => {
      expect(screen.getByText(new RegExp(`${label}.*detail-${kinds[index]}`))).toBeInTheDocument()
    })
  })
  it('discards a delayed timeline response after the selected video changes', async () => {
    let resolveEvents: ((value: { version: 1; accountMid: string; revision: number; items: Array<{ id: string; sequence: number; accountMid: string; aid: number; kind: string; occurredAt: string }> }) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [
        { video: { aid: 1, title: 'First video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
        { video: { aid: 2, title: 'Second video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
      ] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn(async (_account, aid) => ({ video: { aid, title: aid === 1 ? 'First video' : 'Second video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } })),
      getFavoriteRepositoryVideoEvents: vi.fn(() => new Promise((resolve) => { resolveEvents = resolve })),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('First video'))
    fireEvent.click(await screen.findByRole('button', { name: '查看完整处理记录' }))
    fireEvent.click(await screen.findByText('Second video'))
    await act(async () => {
      resolveEvents?.({ version: 1, accountMid: '100', revision: 1, items: [{ id: 'old-event', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }] })
      await Promise.resolve()
    })
    expect(screen.queryByText(/manual-move/)).not.toBeInTheDocument()
  })
  it('loads a subsequent event page without replaying the first page', async () => {
    const getFavoriteRepositoryVideoEvents = vi.fn()
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ id: 'event-2', sequence: 2, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }], nextCursor: '2:event-2' })
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'entered', occurredAt: '2026-07-22T00:00:00.000Z' } ] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      getFavoriteRepositoryVideoEvents, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '查看完整处理记录' }))
    fireEvent.click(await screen.findByRole('button', { name: '加载更早记录' }))
    await waitFor(() => expect(getFavoriteRepositoryVideoEvents).toHaveBeenLastCalledWith('100', 1, { limit: 20, cursor: '2:event-2' }))
    expect(screen.getByText(/entered/)).toBeInTheDocument()
  })
  it('places the no-error embedded layout in the flexible row with a bounded result list', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-22T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, items: [{
          video: { aid: 1, title: '嵌入式视频', tags: [], updatedAt: '2026-07-22T00:00:00.000Z' },
          folderIds: [],
          pendingStates: []
        }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp embedded />)

    const root = await screen.findByRole('main', { name: text.library })
    expect(root).toHaveAttribute('data-embedded', 'true')
    expect(root.querySelector('.favorite-library__header')).not.toBeInTheDocument()
    expect(root.querySelector('.favorite-library__layout')).toHaveAttribute('data-embedded-layout', 'true')
    expect(await screen.findByRole('complementary', { name: '视频详情' })).toHaveTextContent('选择一个视频查看详情')
    expect(await screen.findByRole('listitem')).toHaveTextContent('嵌入式视频')
    expect(root.querySelector('.favorite-library__error')).not.toBeInTheDocument()
    expect(root.children[0]).toHaveClass('favorite-library__layout')
    expect(favoriteLibraryStyles).toMatch(/\.favorite-library\[data-embedded='true'\]\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s)
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__layout { grid-row: 3; height: 100%; min-height: 0; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__results { display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; overflow: visible; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__list-card { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__list { flex: 1 1 auto; height: auto !important; min-height: 0; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] { container-type: inline-size; }"
    )
    expect(favoriteLibraryStyles).toMatch(
      /@container\s+\(max-width: 760px\)\s*\{\s*\.favorite-library\[data-embedded='true'\]\s+\.favorite-library__layout\[data-embedded-layout='true'\]\s*\{/
    )
    expect(favoriteLibraryStyles).toContain(
      "@media (max-width: 760px) { .favorite-library:not([data-embedded='true']) .favorite-library__layout"
    )
  })

  it('keeps internal action failures out of the user-facing alert', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockRejectedValue(new Error('Error invoking remote method favorite-library:sync-selection'))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['unsynced'] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '音乐' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '更多批量操作' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新信息' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('收藏库操作失败。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking remote method')
  })

  it('shows independent placement and metadata labels for an unavailable video', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'local:inbox', title: 'inbox', kind: 'local', syncState: 'local-only' }], physicalShardCount: 0,
        syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [{ video: { aid: 1, title: 'Video + ID', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local:inbox'], pendingStates: ['protected'] }]
      }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        video: { aid: 1, title: 'Video + ID', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local:inbox'], pendingStates: ['protected'], protected: true,
        position: { state: 'failed', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' },
        mirror: { status: 'failed' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Video + ID'))
    const detail = await screen.findByRole('complementary')
    expect(detail).not.toHaveTextContent('资料待刷新')
    expect(detail).toHaveTextContent('同步失败')
    expect(detail).toHaveTextContent('已保护')
    expect(detail).toHaveTextContent('未匹配分类')
  })

  it('uses Chinese controls, selects the current page, and identifies the signed-in account', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const desktop = {
      readBilibiliAccount: vi.fn().mockResolvedValue({ mid: '100', nickname: '小咪' }),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 0,
        folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [
          { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['unsynced'] },
          { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
        ]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection
    }
    window.bilimiDesktop = desktop as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('小咪（UID：100）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    await screen.findByRole('checkbox', { name: '选择 视频一' })
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更多批量操作' }))
    expect(screen.getByRole('button', { name: '刷新信息' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新信息' }))
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', expect.objectContaining({
      kind: 'scope', scope: { kind: 'folder', folderId: 'bilimi-logical:music' }, excludedAids: []
    })))
  })

  it('loads the selected video detail snapshot and exposes its source and archive facts', async () => {
    const getFavoriteRepositoryLibraryVideoDetail = vi.fn().mockResolvedValue({
      video: { aid: 1, cid: 70, title: '已扫描视频', author: 'UP 主', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
      folderIds: ['source'], pendingStates: [],
      mirror: { status: '已同步', lastSyncedAt: '2026-07-20T10:00:00.000Z' },
      transcription: { status: '转写完成' },
      archive: { status: '已入档', versionCount: 2, starred: true, hasMemo: true, memoPreview: '已备注', hasSummary: true }
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'source', title: '默认收藏夹', kind: 'bilibili', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '已扫描视频', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['source'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('已扫描视频'))
    const detail = await screen.findByRole('complementary')
    expect(screen.getByRole('button', { name: '同步状态说明' })).toBeInTheDocument()
    expect(detail).toHaveTextContent('尚未扫描同步状态')
    expect(detail).toHaveTextContent('转写完成')
    expect(detail).toHaveTextContent('已入档')
    expect(screen.getByRole('button', { name: '档案详情' })).toBeEnabled()
    expect(getFavoriteRepositoryLibraryVideoDetail).toHaveBeenCalledWith('100', 1)
    expect(detail).not.toHaveTextContent('取消星标')
    expect(screen.queryByRole('textbox', { name: '档案备注' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存备注' })).not.toBeInTheDocument()
  })

  it('groups a selected video into compact detail sections without legacy scan fragments', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, cid: 70, bvid: 'BV1xx', title: '结构化详情', author: 'UP 主', tags: ['音乐'], favoriteAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, cid: 70, bvid: 'BV1xx', title: '结构化详情', author: 'UP 主', tags: ['音乐'], favoriteAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [], position: { state: 'synced', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-20T00:00:00.000Z' }, mirror: { status: '已同步' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('结构化详情'))

    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('来源与时间')
    expect(detail).toHaveTextContent('音频与档案')
    expect(detail).toHaveTextContent('BV1xx')
    expect(detail).not.toHaveTextContent('分P')
    expect(detail).not.toHaveTextContent('本地镜像')
    expect(detail).not.toHaveTextContent('视频来源')
    expect(detail).not.toHaveTextContent('来源分册')
    expect(detail).not.toHaveTextContent('扫描信息')
  })

  it('uses vertical detail metadata and independent position-based status labels', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, bvid: 'BV1test', title: '独立状态详情', author: 'UP 主', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: ['protected'], libraryStates: { sync: 'synced', protection: 'protected', organization: 'organized' } }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, bvid: 'BV1test', title: '独立状态详情', author: 'UP 主', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: ['protected'], libraryStates: { sync: 'synced', protection: 'protected', organization: 'organized' }, protected: true, position: { state: 'aligned', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], updatedAt: '2026-07-26T00:00:00.000Z' }, mirror: { status: 'failed' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('独立状态详情'))

    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('UP：UP 主 · BV1test')
    expect(detail).toHaveTextContent('收藏归属')
    expect(detail).toHaveTextContent('收藏库归属：音乐')
    expect(detail).toHaveTextContent('B站收藏夹：音乐')
    expect(detail).toHaveTextContent('归属状态：位置一致')
    expect(detail).toHaveTextContent('已整理')
    expect(detail).toHaveTextContent('已保护')
    expect(detail).toHaveTextContent('已同步')
    expect(detail.querySelector('[aria-label="同步状态说明"]')).toHaveAttribute('data-tone', 'success')
    expect(detail.querySelector('[aria-label="保护状态说明"]')).toHaveAttribute('data-tone', 'success')
    expect(detail.querySelector('[aria-label="整理状态说明"]')).toHaveAttribute('data-tone', 'success')
    expect(detail).not.toHaveTextContent('本地位置')
    expect(detail).not.toHaveTextContent('本地归属')
  })

  it('keeps the row and detail sync status aligned with the repository library fact', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, bvid: 'BV1test', title: '未同步详情', author: 'UP 主', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: ['failed'], libraryStates: { sync: 'unsynced', protection: 'unprotected', organization: 'organized' } }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, bvid: 'BV1test', title: '未同步详情', author: 'UP 主', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: ['failed'], libraryStates: { sync: 'unsynced', protection: 'unprotected', organization: 'organized' }, position: { state: 'aligned', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], updatedAt: '2026-07-26T00:00:00.000Z' }, mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    const row = (await screen.findByText('未同步详情')).closest('[role="button"]')
    expect(row?.querySelector('.favorite-library__row-status-sync')).toHaveTextContent('同步失败')

    fireEvent.click(screen.getByText('未同步详情'))
    expect(await screen.findByRole('button', { name: '同步状态说明' })).toHaveTextContent('同步失败')
  })

  it('renders row sync, protection, and organization as centered status text', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '三维行状态', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: [], pendingStates: ['protected', 'unsynced'], libraryStates: { sync: 'unsynced', protection: 'protected', organization: 'organized' } }] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    const row = (await screen.findByText('三维行状态')).closest('[role="button"]')
    const status = row?.querySelector('.favorite-library__row-status')
    expect(status).toHaveTextContent('未同步')
    expect(status?.querySelector('.favorite-library__row-status-sync')).toHaveTextContent('未同步')
    expect(status?.querySelector('.favorite-library__row-status-local')).toHaveTextContent('已保护 · 已整理')
    const transcription = row?.querySelector('.favorite-library__row-transcription')
    expect(transcription?.querySelectorAll('button')[0]).toHaveTextContent('转写音频')
    expect(transcription?.querySelectorAll('button')[1]).toHaveTextContent('档案详情')
  })

  it('keeps the three detail statuses in one natural wrapping row', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '单行详情状态', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: [], pendingStates: ['protected'] }] }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('单行详情状态'))

    const detailStatus = await screen.findByRole('region', { name: '视频状态' })
    expect(detailStatus.querySelectorAll('.favorite-library__status-row')).toHaveLength(1)
    expect(detailStatus.querySelectorAll('button')).toHaveLength(3)
  })

  it('centers matched row columns and stacks transcription actions vertically', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__row-columns > :nth-child(3), .favorite-library__row-columns > :nth-child(4) { display: inline-flex; align-items: center; justify-content: center; }')
    expect(favoriteLibraryStyles).toContain('.favorite-library__row-status { display: grid; align-content: center; justify-items: center; gap: 1px; text-align: center; white-space: normal; overflow-wrap: anywhere;')
    expect(favoriteLibraryStyles).toContain('.favorite-library__row-transcription { display: flex; flex-direction: column; align-items: center; justify-content: center;')
  })

  it('keeps detail transcription and archive actions ahead of their status text', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '档案操作顺序', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, title: '档案操作顺序', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('档案操作顺序'))
    const section = screen.getByRole('heading', { name: '音频与档案' }).closest('section')!
    const enqueue = await within(section).findByRole('button', { name: '视频总结' })
    fireEvent.click(enqueue)
    expect(within(section).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['转写音频', '取消转写', '导出文稿'])
    const archive = screen.getByRole('button', { name: '查看档案详情' })
    expect(archive).toHaveTextContent('笔记档案详情')
    expect(enqueue.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(archive).toBeDisabled()
    expect(enqueue.compareDocumentPosition(section.querySelector('p')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses the shared small porcelain treatment for detail actions', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__status-tags button, .favorite-library__inline-action { float: none; padding: 3px 6px; border: 1px solid #cbdcf5; border-radius: 6px; background: #fff; color: #1e3a8a; font-size: 12px; }')
    expect(favoriteLibraryStyles).toContain('.favorite-library__detail-action-row .favorite-library__batch-destination-trigger { padding: 5px 8px; border: 1px solid #cbdcf5; border-radius: 6px; background: #fff; color: #1e3a8a; font-size: 12px; cursor: pointer; }')
  })

  it('omits unavailable part information from video detail without repeating the AV id', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '未分P详情', author: 'UP 主', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, title: '未分P详情', author: 'UP 主', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: '已同步' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('未分P详情'))

    expect(await screen.findByRole('complementary')).not.toHaveTextContent('分P：暂无信息')
    expect(screen.getByRole('complementary')).not.toHaveTextContent('AV1 · AV1')
  })

  it('renders pending reasons in Chinese instead of repository enum values', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 1, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 1 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '等待确认', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['result-unknown'] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, title: '等待确认', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['result-unknown'], mirror: { status: '已同步' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('等待确认'))
    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('尚未扫描同步状态')
    expect(detail).not.toHaveTextContent('result-unknown')
  })

  it('renders account-scoped navigation, one paged virtual list, and a persistent detail pane', async () => {
    const getPage = vi.fn(async (_accountMid: string, scope: { kind: string; folderId?: string }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: scope.kind === 'folder'
        ? [{ video: { aid: 2, title: 'Folder video', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'All video', author: 'UP', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local', 'remote'], pendingStates: ['failed'] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 2,
        folders: [
          { id: 'remote', title: 'B \u7ad9\u539f\u6536\u85cf', kind: 'bilibili', syncState: 'bound' },
          { id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' },
          { id: 'legacy-staging', title: 'bilimi 暂存', kind: 'bilimi-logical', logicalLedgerId: 'staging', syncState: 'bound' },
          { id: 'local:inbox', title: '暂存', kind: 'local', syncState: 'local-only' }
        ], physicalShardCount: 0, syncRecordCount: 1,
        syncCounts: { pending: 0, succeeded: 0, failed: 1, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText(`小咪${text.library}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.all })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${text.pending} 1` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bilimi 暂存' }).closest('[data-group-id]')).toHaveAttribute('data-group-id', 'workspace')
    expect(screen.getByRole('button', { name: 'bilimi 暂存 菜单' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '未匹配分类' }).closest('[data-group-id]')).toHaveAttribute('data-group-id', 'workspace')
    expect(screen.queryByRole('button', { name: '未匹配分类 菜单' })).not.toBeInTheDocument()
    const list = await screen.findByRole('list', { name: text.videoList })
    expect(list).toHaveAttribute('data-virtualized', 'true')
    fireEvent.click(screen.getByText('All video'))
    expect(await screen.findByRole('complementary')).toHaveTextContent('UP')
    expect(screen.getByRole('complementary')).toHaveTextContent(text.localFolder)

    expect(screen.getByRole('button', { name: text.hideDetail })).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'local' }, { limit: 50, page: 1 }))
    expect(await screen.findByText('Folder video')).toBeInTheDocument()
  })

  it('replaces the visible page when advancing instead of accumulating repository rows', async () => {
    const getPage = vi.fn(async (_accountMid: string, _scope: { kind: string }, options: { page?: number }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: options.page === 2
        ? [{ video: { aid: 2, title: 'Second page', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'First page', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }],
      ...(options.page === 2 ? {} : { nextCursor: '100' })
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('First page')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.nextPage }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 50, page: 2 }))
    expect(await screen.findByText('Second page')).toBeInTheDocument()
    expect(screen.queryByText('First page')).not.toBeInTheDocument()
  })

  it('keeps archive detail unavailable until transcription completes', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '等待转写', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, title: '等待转写', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: '已同步' }, transcription: { status: '正在转写' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('等待转写'))

    expect(await screen.findByRole('button', { name: '查看档案详情' })).toBeDisabled()
    const audioSection = screen.getByRole('heading', { name: '音频与档案' }).closest('section')!
    expect(within(audioSection).getByRole('button', { name: '视频总结' })).toBeInTheDocument()
  })

  it('returns through numbered pages without retaining older page rows', async () => {
    const getPage = vi.fn(async (_accountMid: string, _scope: { kind: string }, options: { page?: number }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: options.page === 2
        ? [{ video: { aid: 2, title: 'Second page history', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'First page history', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }],
      ...(options.page === 2 ? {} : { nextCursor: '100' })
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('First page history')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('Second page history')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 50, page: 1 }))
    expect(await screen.findByText('First page history')).toBeInTheDocument()
    expect(screen.queryByText('Second page history')).not.toBeInTheDocument()
  })

  it('reloads a still-present selected detail from the refreshed repository revision', async () => {
    let notifyRepositoryChange: (() => void) | undefined
    let revision = 2
    const page = () => ({ version: 1 as const, accountMid: '100', revision, items: [{ video: { aid: 1, title: 'Refresh keeps detail', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['bilimi-logical:knowledge'], pendingStates: [] }] })
    const getFavoriteRepositoryLibraryVideoDetail = vi.fn().mockImplementation(async () => ({
      version: 1 as const,
      accountMid: '100',
      revision,
      video: page().items[0].video,
      folderIds: ['bilimi-logical:knowledge'],
      pendingStates: [],
      position: revision === 2
        ? { state: 'local-only-change', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:knowledge'], updatedAt: '2026-07-20T00:00:00.000Z' }
        : { state: 'aligned', localDesiredFolderIds: ['bilimi-logical:knowledge'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:knowledge'], updatedAt: '2026-07-20T00:00:00.000Z' },
      mirror: { status: 'synced' },
      transcription: { status: '未转写' },
      archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockImplementation(async () => ({ version: 1, accountMid: '100', revision, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilimi-logical:knowledge', title: 'bilimi·知识学习', kind: 'bilimi-logical', logicalLedgerId: 'knowledge', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } })),
      getFavoriteRepositoryLibraryPage: vi.fn().mockImplementation(async () => page()),
      getFavoriteRepositoryLibraryVideoDetail,
      subscribeFavoriteRepository: vi.fn((_mid, _folder, callback) => { notifyRepositoryChange = callback; return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Refresh keeps detail'))
    expect(await screen.findByRole('button', { name: '同步状态说明' })).toHaveTextContent('未同步')
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('收藏库与B站位置不同')
    revision = 3
    await act(async () => { notifyRepositoryChange?.() })
    await waitFor(() => expect(screen.getByRole('button', { name: '同步状态说明' })).toHaveTextContent('已同步'))
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('位置一致')
    expect(getFavoriteRepositoryLibraryVideoDetail).toHaveBeenCalledTimes(2)
  })

  it('sends only selected aids or the current local folder to narrow library actions', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ runId: 'library-1', status: 'succeeded' })
    const enqueueFavoriteLibraryTranscription = vi.fn().mockResolvedValue({ status: 'queued' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'bilimi-logical', logicalLedgerId: 'local', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [
          { video: { aid: 1, title: 'One', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] },
          { video: { aid: 2, title: 'Two', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }
        ]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection,
      enqueueFavoriteLibraryTranscription
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: text.localFolder }))
    await screen.findByText('One')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 One' }))
    fireEvent.click(screen.getByRole('button', { name: '视频总结' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '转写音频' }))
    await waitFor(() => expect(enqueueFavoriteLibraryTranscription).toHaveBeenCalledWith('100', { aids: [1] }))
    fireEvent.click(screen.getByRole('button', { name: '刷新信息' }))
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
  })

  it('opens the shared document-export dialog from the selected favorite-library rows', async () => {
    const resolveFavoriteLibraryDocumentExportSelection = vi.fn().mockResolvedValue({ selections: [{ archiveId: 'archive-1', versionId: 'version-1' }], skippedAids: [] })
    let accountChanged: (() => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'bilimi-logical', logicalLedgerId: 'local', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [{ video: { aid: 1, title: 'Export one', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      resolveFavoriteLibraryDocumentExportSelection,
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(),
      onBilibiliAccountChanged: vi.fn((callback) => { accountChanged = callback; return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: text.localFolder }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Export one' }))
    fireEvent.click(screen.getByRole('button', { name: '视频总结' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出文稿' }))

    await waitFor(() => expect(resolveFavoriteLibraryDocumentExportSelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()
    await act(async () => { accountChanged?.() })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出文稿' })).not.toBeInTheDocument())
  })

  it('keeps an all-scope transcription filter in the full-result document-export selection', async () => {
    const resolveFavoriteLibraryDocumentExportSelection = vi.fn().mockResolvedValue({ selections: [{ archiveId: 'archive-1', versionId: 'version-1' }], skippedAids: [] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [{ video: { aid: 1, title: 'Pending export', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['unsynced'] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      resolveFavoriteLibraryDocumentExportSelection,
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByText('Pending export')
    fireEvent.click(screen.getByRole('button', { name: '转写筛选' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '已转写' }))
    await waitFor(() => expect(window.bilimiDesktop.getFavoriteRepositoryLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, expect.objectContaining({ transcriptionFilters: ['completed'] })))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '视频总结' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出文稿' }))

    await waitFor(() => expect(resolveFavoriteLibraryDocumentExportSelection).toHaveBeenCalledWith('100', {
      kind: 'scope', scope: { kind: 'all' }, options: { query: '', filter: 'all', sort: 'updated-desc', transcriptionFilters: ['completed'] }, excludedAids: []
    }))
  })

  it('uses the selected part queue record to retry failed archive registration from detail', async () => {
    const retryVideoAudioArchiveRegistration = vi.fn().mockResolvedValue({ activeItemId: undefined, sessionCompletedCount: 1, items: [] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, cid: 70, title: 'Archive registration retry', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, cid: 70, title: 'Archive registration retry', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: '已同步' }, transcription: { status: '转写完成' }, archive: { status: '登记失败', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ activeItemId: undefined, sessionCompletedCount: 1, items: [{ id: 'account:100:aid:1:cid:70', accountMid: '100', aid: 1, cid: 70, url: 'https://www.bilibili.com/video/BV1archive?p=2', title: 'Archive registration retry', bvid: 'BV1archive', status: 'completed', archiveRegistrationStatus: 'failed', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }] }),
      retryVideoAudioArchiveRegistration,
      onVideoAudioTranscriptionQueueChanged: vi.fn(() => () => undefined),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Archive registration retry'))
    const detailSection = screen.getByRole('heading', { name: '音频与档案' }).closest('section')!
    fireEvent.click(await within(detailSection).findByRole('button', { name: '视频总结' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '转写音频' }))

    await waitFor(() => expect(retryVideoAudioArchiveRegistration).toHaveBeenCalledWith('account:100:aid:1:cid:70'))
  })

  it('shows a cancel-requested transcription as disabled while its worker is still stopping', async () => {
    const cancelVideoAudioTranscription = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, cid: 70, title: 'Stopping transcription', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, cid: 70, title: 'Stopping transcription', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: '已同步' }, transcription: { status: '正在转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ activeItemId: 'account:100:aid:1:cid:70', sessionCompletedCount: 0, items: [{ id: 'account:100:aid:1:cid:70', accountMid: '100', aid: 1, cid: 70, url: 'https://www.bilibili.com/video/BV1stopping?p=2', title: 'Stopping transcription', bvid: 'BV1stopping', status: 'running', cancelRequested: true, progress: { step: 'canceling', message: 'Canceling transcription.' }, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }] }),
      cancelVideoAudioTranscription,
      onVideoAudioTranscriptionQueueChanged: vi.fn(() => () => undefined),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Stopping transcription'))

    const stoppingButtons = await screen.findAllByRole('button', { name: '正在取消…' })
    expect(stoppingButtons).toHaveLength(1)
    expect(stoppingButtons[0]).toBeDisabled()
    fireEvent.click(stoppingButtons[0])
    expect(cancelVideoAudioTranscription).not.toHaveBeenCalled()
  })

  it('labels a waiting transcription cancel action consistently in both the row and detail', async () => {
    const cancelFavoriteLibraryWaitingTranscription = vi.fn().mockResolvedValue({ activeItemId: undefined, sessionCompletedCount: 0, items: [] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, cid: 70, title: 'Waiting transcription', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, cid: 70, title: 'Waiting transcription', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: '已同步' }, transcription: { status: '等待转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ activeItemId: undefined, sessionCompletedCount: 0, items: [{ id: 'account:100:aid:1:cid:70', accountMid: '100', aid: 1, cid: 70, url: 'https://www.bilibili.com/video/BV1waiting?p=2', title: 'Waiting transcription', bvid: 'BV1waiting', status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }] }),
      cancelFavoriteLibraryWaitingTranscription,
      onVideoAudioTranscriptionQueueChanged: vi.fn(() => () => undefined),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Waiting transcription'))

    await waitFor(() => expect(document.querySelector('.favorite-library__row-transcription button')).toHaveAccessibleName('取消转写'))
    expect(screen.queryByRole('button', { name: '取消排队' })).not.toBeInTheDocument()
    const detailSection = screen.getByRole('heading', { name: '音频与档案' }).closest('section')!
    fireEvent.click(within(detailSection).getByRole('button', { name: '视频总结' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '取消转写' }))
    await waitFor(() => expect(cancelFavoriteLibraryWaitingTranscription).toHaveBeenCalledWith('100', { targets: [{ aid: 1, cid: 70 }] }))
  })

  it('clears an all-results selection when changing folders', async () => {
    const getPage = vi.fn(async (_accountMid: string, scope: { kind: string }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: scope.kind === 'folder'
        ? [{ video: { aid: 2, title: 'Folder item', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'All item', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: 'Local', kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByText('All item')
    fireEvent.click(screen.getByRole('button', { name: 'Local' }))
    await screen.findByText('Folder item')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '全部收藏' }))
    await screen.findByText('All item')
    expect(screen.getByRole('checkbox', { name: '选择 All item' })).not.toBeChecked()
  })

  it('clears an all-results selection when changing the search or filter', async () => {
    const getPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 2,
      items: [{ video: { aid: 1, title: 'Search item', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-26T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'local', title: 'Local', kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByText('Search item')
    fireEvent.click(screen.getByRole('button', { name: 'Local' }))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new query' } })
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'local' }, { limit: 50, page: 1, query: 'new query' }))
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  })

  it('clears selection and detail when changing scope while naming refresh actions accurately', async () => {
    const getPage = vi.fn(async (_accountMid: string, scope: { kind: string }, options: { page?: number }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: scope.kind === 'folder'
        ? [{ video: { aid: 2, title: 'Folder video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
        : options.page === 2
          ? [{ video: { aid: 3, title: 'All video page two', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
          : [{ video: { aid: 1, title: 'All video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }],
      ...(scope.kind === 'all' && options.page !== 2 ? { nextCursor: 'next-all-page' } : {})
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'bilimi-logical', logicalLedgerId: 'local', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({
        video: { aid: 1, title: 'All video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [],
        mirror: { status: '已同步' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection: vi.fn().mockResolvedValue({ status: 'succeeded' })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('All video'))
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))

    expect(await screen.findByText('Folder video')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '选择 Folder video' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Folder video' }))
    expect(screen.getByRole('button', { name: '刷新信息' })).toBeEnabled()
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('选择一个视频查看详情')
  })

  it('clears the prior account and rebinds when a repository revision observes an account switch', async () => {
    let notify: (() => void) | undefined
    const getPage = vi.fn(async (accountMid: string) => ({
      version: 1 as const, accountMid, revision: 1,
      items: [{
        video: { aid: Number(accountMid), title: `Video ${accountMid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
        folderIds: [], pendingStates: []
      }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValueOnce('100').mockResolvedValue('101'),
      openFavoriteRepositoryAccount: vi.fn(async (accountMid: string) => ({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn((_accountMid, _folderId, callback) => {
        notify = () => callback({})
        return () => undefined
      })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notify?.() })
    expect(await screen.findByText('Video 101')).toBeInTheDocument()
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
  })

  it('refreshes the current transcription-filtered page when transcription state changes', async () => {
    let notifyTranscriptionChanged: (() => void) | undefined
    const getPage = vi.fn(async (_accountMid: string, _scope: unknown, options: { transcriptionFilters?: string[] }) => ({
      version: 1 as const, accountMid: '100', revision: 1,
      items: [{ video: { aid: 1, title: options.transcriptionFilters?.includes('completed') ? 'Updated transcript row' : 'Initial row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage,
      onFavoriteLibraryTranscriptionChanged: vi.fn((callback) => { notifyTranscriptionChanged = callback; return () => undefined }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Initial row')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '转写筛选' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '已转写' }))
    expect(await screen.findByText('Updated transcript row')).toBeInTheDocument()
    const callsBeforeNotification = getPage.mock.calls.length

    await act(async () => { notifyTranscriptionChanged?.() })

    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(callsBeforeNotification + 1))
    expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, expect.objectContaining({ transcriptionFilters: ['completed'] }))
  })

  it('uses one queue lifecycle event to reload only an active transcription-filtered page', async () => {
    let notifyQueue: ((snapshot: { activeItemId?: string; sessionCompletedCount: number; items: Array<Record<string, unknown>> }) => void) | undefined
    const onLegacyChanged = vi.fn(() => () => undefined)
    const openAccount = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
      folders: [], physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
    })
    const getPage = vi.fn(async (_accountMid: string, _scope: unknown, options: { transcriptionFilters?: string[] }) => ({
      version: 1 as const, accountMid: '100', revision: 1,
      items: [{ video: { aid: 1, title: options.transcriptionFilters?.includes('completed') ? 'Completed row' : 'Initial row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'), openFavoriteRepositoryAccount: openAccount,
      getFavoriteRepositoryLibraryPage: getPage, subscribeFavoriteRepository: vi.fn(() => () => undefined),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ sessionCompletedCount: 0, items: [] }),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => { notifyQueue = callback as typeof notifyQueue; return () => undefined }),
      onFavoriteLibraryTranscriptionChanged: onLegacyChanged
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Initial row')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '\u8f6c\u5199\u7b5b\u9009' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '\u5df2\u8f6c\u5199' }))
    expect(await screen.findByText('Completed row')).toBeInTheDocument()
    const pageCalls = getPage.mock.calls.length
    const accountCalls = openAccount.mock.calls.length

    await act(async () => { notifyQueue?.({ sessionCompletedCount: 1, items: [{ id: 'job-1', accountMid: '100', aid: 1, status: 'completed', archiveRegistrationStatus: 'registered', updatedAt: '2026-07-27T00:00:01.000Z' }] }) })

    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(pageCalls + 1))
    expect(openAccount).toHaveBeenCalledTimes(accountCalls)
    expect(onLegacyChanged).not.toHaveBeenCalled()
    expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, expect.objectContaining({ transcriptionFilters: ['completed'] }))
  })

  it('does not reload a transcription-filtered page for progress-only queue snapshots', async () => {
    let notifyQueue: ((snapshot: { activeItemId?: string; sessionCompletedCount: number; items: Array<Record<string, unknown>> }) => void) | undefined
    const queueItem = { id: 'job-1', accountMid: '100', aid: 1, status: 'running', updatedAt: '2026-07-27T00:00:00.000Z' }
    const getPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: 'Running row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage, subscribeFavoriteRepository: vi.fn(() => () => undefined),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({ activeItemId: 'job-1', sessionCompletedCount: 0, items: [queueItem] }),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => { notifyQueue = callback as typeof notifyQueue; return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Running row')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '\u8f6c\u5199\u7b5b\u9009' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '\u8fdb\u884c\u4e2d' }))
    await waitFor(() => expect(getPage.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ transcriptionFilters: ['running'] })))
    const pageCalls = getPage.mock.calls.length

    await act(async () => { notifyQueue?.({ activeItemId: 'job-1', sessionCompletedCount: 0, items: [{ ...queueItem, progress: { percent: 50 } }] }) })

    await act(async () => {})
    expect(getPage).toHaveBeenCalledTimes(pageCalls)
  })

  it('clears transcription filters when navigating to pending work', async () => {
    let notifyRepository: (() => void) | undefined
    const getPage = vi.fn(async (_accountMid: string, scope: { kind: string }, options: { transcriptionFilters?: string[] }) => ({
      version: 1 as const, accountMid: '100', revision: 1,
      items: [{ video: { aid: 1, title: scope.kind === 'pending' ? 'Pending row' : options.transcriptionFilters?.includes('completed') ? 'Completed row' : 'All row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 1, succeeded: 0, failed: 1, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn((_accountMid, _folderId, callback) => { notifyRepository = () => callback({}); return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('All row')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '转写筛选' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '已转写' }))
    expect(await screen.findByText('Completed row')).toBeInTheDocument()
    await act(async () => { notifyRepository?.() })
    fireEvent.click(await screen.findByRole('button', { name: 'go-pending-scope' }))

    await waitFor(() => expect(getPage.mock.calls.at(-1)?.slice(0, 2)).toEqual(['100', { kind: 'pending' }]))
    expect(await screen.findByText('Pending row')).toBeInTheDocument()
    const pendingOptions = getPage.mock.calls.at(-1)?.[2]
    expect(getPage.mock.calls.at(-1)?.slice(0, 2)).toEqual(['100', { kind: 'pending' }])
    expect(pendingOptions).not.toHaveProperty('transcriptionFilters')
  })

  it('clears the prior account when the desktop account-change signal arrives without a repository revision', async () => {
    let notifyAccountChange: (() => void) | undefined
    const getPage = vi.fn(async (accountMid: string) => ({
      version: 1 as const, accountMid, revision: 1,
      items: [{
        video: { aid: Number(accountMid), title: `Video ${accountMid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
        folderIds: [], pendingStates: []
      }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValueOnce('100').mockResolvedValue('101'),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn(async (accountMid: string) => ({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByText('Video 101')).toBeInTheDocument()
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
  })

  it('clears the account identity and its subscription after logout', async () => {
    let notifyAccountChange: (() => void) | undefined
    const unsubscribe = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValueOnce('100').mockResolvedValue(''),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 100, title: 'Video 100', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => unsubscribe)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByRole('alert')).toHaveTextContent('\u8bf7\u5148\u767b\u5f55 B \u7ad9\u8d26\u53f7\u3002')
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
    expect(screen.queryByText('\u8d26\u53f7 100')).not.toBeInTheDocument()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('keeps the newest folder page when an older request resolves last', async () => {
    let resolveAll: ((value: { version: 1; accountMid: string; revision: number; items: never[] }) => void) | undefined
    const getPage = vi.fn((_accountMid: string, scope: { kind: string; folderId?: string }) => {
      if (scope.kind === 'all') return new Promise((resolve) => { resolveAll = resolve })
      return Promise.resolve({
        version: 1 as const, accountMid: '100', revision: 1,
        items: [{ video: { aid: 2, title: 'Folder wins', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
      })
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await waitFor(() => expect(resolveAll).toBeTypeOf('function'))
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))
    expect(await screen.findByText('Folder wins')).toBeInTheDocument()
    resolveAll?.({ version: 1, accountMid: '100', revision: 1, items: [] })
    await Promise.resolve()
    expect(screen.getByText('Folder wins')).toBeInTheDocument()
  })

  it('resets a cached long-list offset before rendering a shorter folder page', async () => {
    const allItems = Array.from({ length: 50 }, (_, index) => ({
      video: { aid: index + 1, title: `All ${index + 1}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' },
      folderIds: [],
      pendingStates: []
    }))
    const folderItems = Array.from({ length: 17 }, (_, index) => ({
      video: { aid: 100 + index, title: `Folder ${index + 1}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' },
      folderIds: ['short-folder'],
      pendingStates: []
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 67, folderCount: 1,
        folders: [{ id: 'short-folder', title: '短列表', kind: 'bilimi-logical', logicalLedgerId: 'short-folder', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn(async (_accountMid: string, scope: { kind: string }) => ({
        version: 1 as const, accountMid: '100', revision: 1,
        totalCount: scope.kind === 'folder' ? folderItems.length : allItems.length,
        items: scope.kind === 'folder' ? folderItems : allItems
      })),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('All 1')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: text.videoList })
    list.scrollTop = 20_000
    fireEvent.scroll(list)

    fireEvent.click(screen.getByRole('button', { name: '短列表' }))

    expect(await screen.findByText('Folder 1')).toBeInTheDocument()
    expect(list.scrollTop).toBe(0)
  })

  it('renders nonempty search, status, and transcription-filter pages after a long-list offset', async () => {
    const resultForOptions = (options: { query?: string; stateFilters?: { sync?: string }; transcriptionFilters?: string[] }) => {
      const title = options.transcriptionFilters?.includes('completed')
        ? 'Transcription result'
        : options.stateFilters?.sync === 'unsynced'
          ? 'Status result'
          : options.query
            ? 'Search result'
            : 'Unfiltered result'
      return [{ video: { aid: 1, title, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
    }
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn(async (_accountMid: string, _scope, options) => ({
        version: 1 as const, accountMid: '100', revision: 1, totalCount: 1, items: resultForOptions(options)
      })),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Unfiltered result')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: text.videoList })
    list.scrollTop = 20_000
    fireEvent.scroll(list)

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: 'match' } })
    expect(await screen.findByText('Search result')).toBeInTheDocument()
    expect(list.scrollTop).toBe(0)

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏库' }), { target: { value: '' } })
    expect(await screen.findByText('Unfiltered result')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '状态筛选' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步筛选' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '未同步' }))
    expect(await screen.findByText('Status result')).toBeInTheDocument()
    expect(list.scrollTop).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '转写筛选' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '已转写' }))
    expect(await screen.findByText('Transcription result')).toBeInTheDocument()
    expect(list.scrollTop).toBe(0)
  })

  it('keeps account A cached while its short restored page clamps an invalid old offset', async () => {
    let notifyAccountChange: (() => void) | undefined
    let currentAccount = '100'
    let resolveReturningA: ((value: { version: 1; accountMid: string; revision: number; items: Array<{ video: { aid: number; title: string; tags: never[]; updatedAt: string }; folderIds: never[]; pendingStates: never[] }> }) => void) | undefined
    let readsForA = 0
    const accountSummary = (accountMid: string) => ({
      version: 1 as const, accountMid, revision: accountMid === '100' ? 7 : 3, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
      folders: [], physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn(() => Promise.resolve(currentAccount)),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn((accountMid: string) => Promise.resolve(accountSummary(accountMid))),
      getFavoriteRepositoryLibraryPage: vi.fn((accountMid: string) => {
        if (accountMid === '100' && ++readsForA === 2) return new Promise((resolve) => { resolveReturningA = resolve })
        return Promise.resolve({
          version: 1 as const, accountMid, revision: accountMid === '100' ? 7 : 3,
          items: [{ video: { aid: Number(accountMid), title: `Account ${accountMid}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
        })
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Account 100')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: text.videoList })
    list.scrollTop = 160
    fireEvent.scroll(list)
    currentAccount = '200'
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByText('Account 200')).toBeInTheDocument()
    list.scrollTop = 0
    fireEvent.scroll(list)
    currentAccount = '100'
    await act(async () => { notifyAccountChange?.() })

    expect(await screen.findByText('Account 100')).toBeInTheDocument()
    expect(screen.queryByText('Account 200')).not.toBeInTheDocument()
    // The cached offset is revalidated against the restored page height.
    expect(list.scrollTop).toBe(0)
    await act(async () => {
      resolveReturningA?.({
        version: 1, accountMid: '100', revision: 7,
        items: [{ video: { aid: 100, title: 'Account 100 refreshed', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      })
    })
    expect(await screen.findByText('Account 100 refreshed')).toBeInTheDocument()
  })

  it('restores a cached folder page with the same folder heading when switching accounts', async () => {
    let notifyAccountChange: (() => void) | undefined
    let currentAccount = '100'
    let resolveReturningFolder!: (value: Record<string, unknown>) => void
    let account100Reads = 0
    const summary = (accountMid: string) => ({
      version: 1 as const, accountMid, revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: accountMid === '100' ? 1 : 0,
      folders: accountMid === '100' ? [{ id: 'local', title: 'Local folder', kind: 'local' as const, syncState: 'local' as const }] : [],
      physicalShardCount: 0, syncRecordCount: 0, folderCounts: accountMid === '100' ? { local: 1 } : {},
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn(() => Promise.resolve(currentAccount)),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn((accountMid: string) => Promise.resolve(summary(accountMid))),
      getFavoriteRepositoryLibraryPage: vi.fn((accountMid: string, scope: { kind: string }) => {
        if (accountMid === '100' && ++account100Reads === 3) return new Promise((resolve) => { resolveReturningFolder = resolve })
        const folder = scope.kind === 'folder'
        return Promise.resolve({ version: 1 as const, accountMid, revision: 1, totalCount: 1, items: [{ video: { aid: folder ? 10 : Number(accountMid), title: folder ? 'Cached folder row' : `Account ${accountMid}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: folder ? ['local'] : [], pendingStates: [] }] })
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    await screen.findByText('Account 100')
    fireEvent.click(screen.getByRole('button', { name: 'Local folder' }))
    expect(await screen.findByText('Cached folder row')).toBeInTheDocument()
    currentAccount = '200'
    await act(async () => { notifyAccountChange?.() })
    await screen.findByText('Account 200')
    currentAccount = '100'
    await act(async () => { notifyAccountChange?.() })

    expect(await screen.findByRole('heading', { name: 'Local folder 1 个视频' })).toBeInTheDocument()
    expect(screen.getByText('Cached folder row')).toBeInTheDocument()
    await act(async () => { resolveReturningFolder({ version: 1, accountMid: '100', revision: 1, totalCount: 1, items: [{ video: { aid: 10, title: 'Refreshed folder row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }] }) })
    expect(await screen.findByText('Refreshed folder row')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Local folder 1 个视频' })).toBeInTheDocument()
  })

  it('invalidates only the cleared account cache before a later account switch', async () => {
    let notifyAccountChange: (() => void) | undefined
    let notifyAccountDataCleared: ((accountMid: string) => void) | undefined
    let currentAccount = '100'
    const pageCalls = new Map<string, number>()
    let resolveClearedAccountPage: ((value: { version: 1; accountMid: string; revision: number; items: Array<{ video: { aid: number; title: string; tags: never[]; updatedAt: string }; folderIds: never[]; pendingStates: never[] }> }) => void) | undefined
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn(() => Promise.resolve(currentAccount)),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      // The renderer needs an account-scoped local-data notification instead of clearing all views.
      onFavoriteRepositoryAccountDataCleared: vi.fn((callback: (accountMid: string) => void) => { notifyAccountDataCleared = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn((accountMid: string) => Promise.resolve({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage: vi.fn((accountMid: string) => {
        const call = (pageCalls.get(accountMid) ?? 0) + 1
        pageCalls.set(accountMid, call)
        if (accountMid === '100' && call === 2) return new Promise((resolve) => { resolveClearedAccountPage = resolve })
        return Promise.resolve({
          version: 1 as const, accountMid, revision: 1,
          items: [{ video: { aid: Number(accountMid), title: `Account ${accountMid} load ${call}`, tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
        })
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Account 100 load 1')).toBeInTheDocument()
    currentAccount = '200'
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByText('Account 200 load 1')).toBeInTheDocument()
    expect(window.bilimiDesktop.onFavoriteRepositoryAccountDataCleared).toHaveBeenCalled()
    await act(async () => { notifyAccountDataCleared?.('100') })
    currentAccount = '100'
    await act(async () => { notifyAccountChange?.() })

    expect(await screen.findByRole('status', { name: '\u6b63\u5728\u8bfb\u53d6\u6536\u85cf\u5e93' })).toBeInTheDocument()
    expect(screen.queryByText('Account 100 load 1')).not.toBeInTheDocument()
    await act(async () => {
      resolveClearedAccountPage?.({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 100, title: 'Account 100 load 2', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      })
    })
    expect(await screen.findByText('Account 100 load 2')).toBeInTheDocument()
    expect(screen.queryByText('Account 200 load 1')).not.toBeInTheDocument()
  })

  it('rejects a page response whose repository revision does not match its summary', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 8, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 7,
        items: [{ video: { aid: 7, title: 'Stale revision row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    await screen.findByRole('status', { name: '\u6b63\u5728\u8bfb\u53d6\u6536\u85cf\u5e93' })
    expect(screen.queryByText('Stale revision row')).not.toBeInTheDocument()
  })

  it('keeps cached rows visible when a revision refresh fails', async () => {
    let notify: (() => void) | undefined
    const getPage = vi.fn()
      .mockResolvedValueOnce({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 1, title: 'Cached row', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      })
      .mockRejectedValueOnce(new Error('offline'))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn((_accountMid, _folderId, callback) => { notify = () => callback({}); return () => undefined })
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    expect(await screen.findByText('Cached row')).toBeInTheDocument()
    await act(async () => { notify?.() })

    expect(await screen.findByRole('alert')).toHaveTextContent('\u6536\u85cf\u5e93\u65e0\u6cd5\u8bfb\u53d6\u3002')
    expect(screen.getByText('Cached row')).toBeInTheDocument()
  })

  it('recovers detail metadata after a failed read when the user explicitly refreshes it', async () => {
    const getDetail = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        version: 1, accountMid: '100', revision: 1,
        video: { aid: 1, title: 'Recoverable detail', description: 'Recovered description', tags: ['recovered'], updatedAt: '2026-07-27T00:00:00.000Z' },
        folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '\u672a\u8f6c\u5199' },
        archive: { status: '\u672a\u5165\u6863', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-27T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 1, title: 'Recoverable detail', tags: [], updatedAt: '2026-07-27T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      }),
      getFavoriteRepositoryLibraryVideoDetail: getDetail,
      syncFavoriteLibrarySelection: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Recoverable detail'))
    await screen.findByRole('alert')
    expect(getDetail).toHaveBeenCalledTimes(1)
    fireEvent.click(within(screen.getByRole('complementary', { name: text.detail })).getByRole('button', { name: '\u5237\u65b0\u4fe1\u606f' }))

    await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '\u66f4\u591a\u4fe1\u606f' }))
    expect(await screen.findByText('简介：Recovered description')).toBeInTheDocument()
  })
})
