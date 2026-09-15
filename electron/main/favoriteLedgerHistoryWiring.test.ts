import { describe, expect, it, vi } from 'vitest'
import { recordFavoriteLedgerHistoryAroundMutation } from './favoriteLedgerHistoryWiring'

describe('favorite ledger history wiring', () => {
  it('records the authoritative rule state around a preference mutation', async () => {
    const before = { ledgers: [], adoptedCandidateIds: [], excludedLedgerIds: [] }
    const after = { ledgers: [{ id: 'music' }], adoptedCandidateIds: ['custom-music'], excludedLedgerIds: ['music'] }
    const get = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after)
    const record = vi.fn().mockResolvedValue(undefined)

    await recordFavoriteLedgerHistoryAroundMutation('100', { get, record }, async () => 'saved')

    expect(record).toHaveBeenCalledWith('100', { before, after })
  })

  it('does not block a local save when the organize workspace has not started', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Old favorite workspace has not been started.'))
    const record = vi.fn().mockResolvedValue(undefined)
    const mutate = vi.fn().mockResolvedValue('saved')

    await expect(recordFavoriteLedgerHistoryAroundMutation('100', { get, record }, mutate)).resolves.toBe('saved')

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(record).not.toHaveBeenCalled()
  })
})
