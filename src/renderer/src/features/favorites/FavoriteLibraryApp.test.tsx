import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryApp } from './FavoriteLibraryApp'

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

afterEach(() => {
  cleanup()
  window.bilimiDesktop = undefined
})

describe('FavoriteLibraryApp', () => {
  it('renders account-scoped navigation, one paged virtual list, and a collapsible detail pane', async () => {
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
          { id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }
        ], physicalShardCount: 0, syncRecordCount: 1,
        syncCounts: { pending: 0, succeeded: 0, failed: 1, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByRole('heading', { name: text.library })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.all })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${text.pending} 1` })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: text.videoList })
    expect(list).toHaveAttribute('data-virtualized', 'true')
    fireEvent.click(screen.getByText('All video'))
    expect(await screen.findByRole('complementary', { name: text.detail })).toHaveTextContent('UP')
    expect(screen.getByRole('complementary', { name: text.detail })).toHaveTextContent(text.localFolder)

    fireEvent.click(screen.getByRole('button', { name: text.hideDetail }))
    expect(screen.queryByRole('complementary', { name: text.detail })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'local' }, { limit: 100 }))
    expect(await screen.findByText('Folder video')).toBeInTheDocument()
  })

  it('replaces the visible page when advancing instead of accumulating repository rows', async () => {
    const getPage = vi.fn(async (_accountMid: string, _scope: { kind: string }, options: { cursor?: string }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: options.cursor
        ? [{ video: { aid: 2, title: 'Second page', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'First page', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }],
      ...(options.cursor ? {} : { nextCursor: '100' })
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
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('First page')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.nextPage }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 100, cursor: '100' }))
    expect(await screen.findByText('Second page')).toBeInTheDocument()
    expect(screen.queryByText('First page')).not.toBeInTheDocument()
  })

  it('sends only selected aids or the current local folder to narrow library actions', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ runId: 'library-1', status: 'succeeded' })
    const enqueueFavoriteLibraryTranscription = vi.fn().mockResolvedValue({ status: 'queued' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
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
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByText('One')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Queue transcription' }))
    await waitFor(() => expect(enqueueFavoriteLibraryTranscription).toHaveBeenCalledWith('100', { aids: [1] }))
    fireEvent.click(screen.getByRole('button', { name: 'Sync selected' }))
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
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
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notify?.() })
    expect(await screen.findByText('Video 101')).toBeInTheDocument()
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

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
    } as typeof window.bilimiDesktop

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
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await waitFor(() => expect(resolveAll).toBeTypeOf('function'))
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))
    expect(await screen.findByText('Folder wins')).toBeInTheDocument()
    resolveAll?.({ version: 1, accountMid: '100', revision: 1, items: [] })
    await Promise.resolve()
    expect(screen.getByText('Folder wins')).toBeInTheDocument()
  })
})
