import { describe, expect, it, vi } from 'vitest'
import { BilibiliFavoriteSpaceRefreshCoordinator } from './bilibiliFavoriteSpaceRefreshCoordinator'

describe('BilibiliFavoriteSpaceRefreshCoordinator', () => {
  it('keeps a retryable pending state when a confirmed folder mutation cannot refresh the favorite-space page', async () => {
    const statuses: Array<{ accountMid: string; status: 'idle' | 'pending' }> = []
    const refreshProjection = vi.fn().mockResolvedValue(undefined)
    const refreshFavoriteSpacePages = vi.fn().mockResolvedValue({ requested: 1, completed: 0, failed: 1 })
    const coordinator = new BilibiliFavoriteSpaceRefreshCoordinator({
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      refreshProjection,
      refreshFavoriteSpacePages,
      onStatusChange: (accountMid, status) => statuses.push({ accountMid, status: status.status })
    })

    await expect(coordinator.refresh('100')).resolves.toEqual({ status: 'pending' })
    expect(coordinator.getStatus('100')).toEqual({ status: 'pending' })
    expect(statuses).toEqual([{ accountMid: '100', status: 'pending' }])

    refreshFavoriteSpacePages.mockResolvedValueOnce({ requested: 1, completed: 1, failed: 0 })

    await expect(coordinator.retry('100')).resolves.toEqual({ status: 'idle' })
    expect(refreshProjection).toHaveBeenCalledTimes(2)
    expect(refreshFavoriteSpacePages).toHaveBeenCalledTimes(2)
    expect(statuses).toEqual([
      { accountMid: '100', status: 'pending' },
      { accountMid: '100', status: 'idle' }
    ])
  })
})
