import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDrawer } from './FavoriteLibraryDrawer'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FavoriteLibraryDrawer integration', () => {
  it('keeps three live panes and routes a remote reconciliation warning to pending', async () => {
    const getPage = vi.fn().mockResolvedValue({
      version: 1, accountMid: '100', revision: 1,
      items: [{
        video: { aid: 1, title: '待对账视频', author: 'UP 主', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' },
        folderIds: [], pendingStates: ['result-unknown']
      }]
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 1,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 1 },
        remoteReconciliations: [{ kind: 'unfavorite', operationId: 'remote-1' }]
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(await screen.findByText('远程操作待处理')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-library-drawer').querySelectorAll('.favorite-library__layout > *')).toHaveLength(3)
    expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('选择一个视频查看详情')

    fireEvent.click(screen.getByRole('button', { name: '去待处理' }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'pending' }, { limit: 50 }))
  })
})
